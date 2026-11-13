import { Conflict } from '../audit.ts';
import { config } from '../config.ts';

const manualMessage = '当前工作台采用手工交付。请下载已批准版本后，由运营上传。';

/** Deployment permissions, independent of credentials and the existing publishing preferences. */
export function studioDeliveryCapabilities() {
  const mode = config.studioDeliveryMode;
  const wordpressWritesAllowed = mode === 'wordpress';
  return {
    mode,
    wordpressWritesAllowed,
    draftPushAllowed: wordpressWritesAllowed && config.wpDraftPushEnabled,
    readOnlyRecoveryAllowed: true as const,
    message: wordpressWritesAllowed ? null : manualMessage,
  };
}

export class ManualDeliveryError extends Conflict {
  constructor() {
    super(manualMessage);
    this.name = 'ManualDeliveryError';
  }
}

/** Check again at the external-write boundary so retained jobs and clients cannot bypass it. */
export function requireStudioWordPressWrite() {
  if (!studioDeliveryCapabilities().wordpressWritesAllowed) throw new ManualDeliveryError();
}
