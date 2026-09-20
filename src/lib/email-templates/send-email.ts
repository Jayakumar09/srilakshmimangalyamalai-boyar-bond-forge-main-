import * as React from 'react'
import { render } from '@react-email/render'
import { Resend } from 'resend'
import { TEMPLATES } from './registry'

// Server-only: reads RESEND_API_KEY. Never import from client components.

const SITE_NAME = "Sri Lakshmi Mangalya Malai"
// Default sender on the verified Resend domain. Override via RESEND_FROM.
const DEFAULT_FROM = `${SITE_NAME} <vijayalakshmi@srilakshmimangalyamalai.com>`

export type SendTemplateEmailResult =
  | { sent: true }
  | { sent: false; reason: 'recipient_suppressed' }

export interface SendTemplateEmailOptions {
  templateData?: Record<string, any>
  /** Dedupes retries of the same logical send; mapped to Resend's Idempotency-Key header. */
  idempotencyKey?: string
  replyTo?: string
}

/**
 * Renders a registered template and sends it through Resend. Any failure
 * throws — callers record the failure (e.g., in the notifications table).
 */
export async function sendTemplateEmail(
  templateName: string,
  to: string,
  options: SendTemplateEmailOptions = {}
): Promise<SendTemplateEmailResult> {
  const apiKey = process.env['RESEND_API_KEY']
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured')
  }

  const template = TEMPLATES[templateName]
  if (!template) {
    throw new Error(
      `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(', ')}`
    )
  }

  // Template-level `to` takes precedence — notification templates always
  // send to their fixed address.
  const recipient = template.to || to
  if (!recipient) {
    throw new Error('Recipient is required (the template defines no fixed recipient)')
  }

  const templateData = options.templateData ?? {}
  const element = React.createElement(template.component, templateData)
  const html = await render(element)
  const text = await render(element, { plainText: true })
  const subject =
    typeof template.subject === 'function'
      ? template.subject(templateData)
      : template.subject

  const from = process.env['RESEND_FROM'] || DEFAULT_FROM
  const resend = new Resend(apiKey)
  const { data, error } = await resend.emails.send({
    from,
    to: recipient,
    subject,
    html,
    text,
    ...(options.replyTo ? { reply_to: options.replyTo } : {}),
    headers: { 'Idempotency-Key': options.idempotencyKey || crypto.randomUUID() },
  })
  if (!data || error) {
    throw new Error(error?.message ?? 'Resend email failed')
  }

  return { sent: true }
}