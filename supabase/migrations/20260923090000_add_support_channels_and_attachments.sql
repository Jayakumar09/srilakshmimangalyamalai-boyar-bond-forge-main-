-- PHASE 2: office<->member communication channels + message attachments
-- Three separated office channels: support | messages | communication
-- Attachments reuse private R2 storage; metadata only is stored on support_messages.

ALTER TABLE public.support_threads
  ADD COLUMN channel text NOT NULL DEFAULT 'support';

ALTER TABLE public.support_threads
  ADD CONSTRAINT support_threads_channel_chk
  CHECK (channel IN ('support', 'messages', 'communication'));

ALTER TABLE public.support_messages
  ADD COLUMN attachment_key text,
  ADD COLUMN attachment_name text,
  ADD COLUMN attachment_mime text,
  ADD COLUMN attachment_size bigint;