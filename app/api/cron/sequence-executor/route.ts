import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Find enrollments ready to execute
    const { data: ready, error } = await supabase
      .from('sequence_enrollments')
      .select(`
        id, client_id, sequence_id, contact_id, current_step, opportunity_id,
        sequences!inner(name),
        contacts!inner(first_name, last_name, phone, email)
      `)
      .eq('status', 'active')
      .lte('next_step_at', new Date().toISOString())
      .limit(50);

    if (error) {
      console.error('Sequence query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!ready || ready.length === 0) {
      return NextResponse.json({ processed: 0 });
    }

    let processed = 0;
    let errors = 0;

    for (const enrollment of ready) {
      try {
        const nextStepNum = enrollment.current_step + 1;

        // Get the next step
        const { data: step } = await supabase
          .from('sequence_steps')
          .select('*')
          .eq('sequence_id', enrollment.sequence_id)
          .eq('step_number', nextStepNum)
          .single();

        if (!step) {
          // No more steps — mark sequence as completed
          await supabase
            .from('sequence_enrollments')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', enrollment.id);

          // Increment completed_count (non-atomic but functional)
          try {
            await supabase.rpc('increment_sequence_count', {
              seq_id: enrollment.sequence_id,
              count_field: 'completed_count'
            });
          } catch {
            const { data } = await supabase.from('sequences')
              .select('completed_count')
              .eq('id', enrollment.sequence_id)
              .single();
            if (data) {
              await supabase.from('sequences')
                .update({ completed_count: (data.completed_count || 0) + 1 })
                .eq('id', enrollment.sequence_id);
            }
          }

          processed++;
          continue;
        }

        // Execute based on step type
        if (step.step_type === 'wait') {
          // Calculate next execution time
          const nextAt = new Date(Date.now() + (step.delay_minutes || 0) * 60 * 1000);
          await supabase
            .from('sequence_enrollments')
            .update({ current_step: nextStepNum, next_step_at: nextAt.toISOString() })
            .eq('id', enrollment.id);
        } else if (step.step_type === 'sms' || step.step_type === 'whatsapp') {
          // 2026-05-12 — Twilio no longer in use. SMS/WhatsApp sequence steps
          // can't execute. Cancel the enrollment with a clear reason rather
          // than failing silently or retrying forever. Re-enable by setting
          // TWILIO_ENABLED=1 in Vercel env (and re-provisioning Twilio creds).
          if (process.env.TWILIO_ENABLED !== '1') {
            await supabase
              .from('sequence_enrollments')
              .update({ status: 'cancelled', metadata: { reason: 'twilio_disabled', step_type: step.step_type } })
              .eq('id', enrollment.id);
            console.warn(`[sequence-executor] cancelled enrollment ${enrollment.id} — TWILIO_ENABLED!=1, step_type=${step.step_type}`);
            continue;
          }
          // Get client config for business name
          const { data: config } = await supabase
            .from('agent_config')
            .select('business_name')
            .eq('client_id', enrollment.client_id)
            .single();

          // Template variable replacement
          const contact = enrollment.contacts as any;
          let body = (step.template_body || '')
            .replace(/\{\{first_name\}\}/g, contact?.first_name || 'there')
            .replace(/\{\{last_name\}\}/g, contact?.last_name || '')
            .replace(/\{\{business_name\}\}/g, config?.business_name || 'us');

          const phone = contact?.phone;
          if (!phone) {
            // Can't send — no phone number
            await supabase
              .from('sequence_enrollments')
              .update({ status: 'cancelled', metadata: { reason: 'no_phone' } })
              .eq('id', enrollment.id);
            continue;
          }

          // Send via Twilio
          const twilioSid = process.env.TWILIO_ACCOUNT_SID;
          const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
          const twilioFrom = process.env.TWILIO_PHONE_NUMBER;

          if (twilioSid && twilioAuth && twilioFrom) {
            const toNumber = step.step_type === 'whatsapp' ? `whatsapp:${phone}` : phone;
            const fromNumber = step.step_type === 'whatsapp' ? `whatsapp:${twilioFrom}` : twilioFrom;

            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
            const twilioBody = new URLSearchParams({
              To: toNumber,
              From: fromNumber,
              Body: body,
            });

            const twilioResponse = await fetch(twilioUrl, {
              method: 'POST',
              headers: {
                'Authorization': 'Basic ' + Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: twilioBody.toString(),
            });

            const twilioResult = await twilioResponse.json();

            // Log to comms_log
            await supabase.from('comms_log').insert({
              client_id: enrollment.client_id,
              contact_id: enrollment.contact_id,
              channel: step.step_type,
              direction: 'outbound',
              body: body,
              status: twilioResult.sid ? 'sent' : 'failed',
              provider: 'twilio',
              external_id: twilioResult.sid,
              from_address: fromNumber,
              to_address: toNumber,
              sequence_id: enrollment.sequence_id,
              sent_at: new Date().toISOString(),
            });
          }

          // Advance to next step
          const nextStep = nextStepNum + 1;
          const { data: followingStep } = await supabase
            .from('sequence_steps')
            .select('delay_minutes')
            .eq('sequence_id', enrollment.sequence_id)
            .eq('step_number', nextStep)
            .single();

          const delayMs = (followingStep?.delay_minutes || 0) * 60 * 1000;
          const nextAt = new Date(Date.now() + delayMs);

          await supabase
            .from('sequence_enrollments')
            .update({ current_step: nextStepNum, next_step_at: nextAt.toISOString() })
            .eq('id', enrollment.id);
        }

        processed++;
      } catch (stepError: any) {
        console.error(`Failed to process enrollment ${enrollment.id}:`, stepError);
        errors++;
      }
    }

    return NextResponse.json({ processed, errors, total: ready.length });
  } catch (error: any) {
    console.error('Sequence executor error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
