const WARN_YELLOW_DAYS = 7;
const WARN_RED_DAYS = 3;

export function maybePrintExpiryWarning(expiresAt: string): void {
  if (!expiresAt) return;

  const expiresMs = new Date(expiresAt).getTime();
  if (isNaN(expiresMs)) return;

  const daysLeft = Math.floor((expiresMs - Date.now()) / (1000 * 60 * 60 * 24));

  if (daysLeft > WARN_YELLOW_DAYS) return;

  const daysLabel = daysLeft <= 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
  const prefix = daysLeft <= WARN_RED_DAYS ? '⚠ ' : '⚠ ';

  process.stderr.write(
    `${prefix}Your ctxloom license expires ${daysLabel}.\n  Renew: https://ctxloom.com/account/renew\n\n`,
  );
}
