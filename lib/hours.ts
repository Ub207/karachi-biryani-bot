function timeToMinutes(timeStr: string): number {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return -1;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === 'AM' && h === 12) h = 0;
  if (period === 'PM' && h !== 12) h += 12;
  return h * 60 + m;
}

function nowMinutes(timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(new Date());
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return h * 60 + m;
}

function parseRange(hoursStr: string) {
  const match = hoursStr.match(
    /(\d{1,2}:\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}:\d{2}\s*[AP]M)/i
  );
  if (!match) return null;
  const openStr = match[1].trim();
  const closeStr = match[2].trim();
  const openMin = timeToMinutes(openStr);
  const closeMin = timeToMinutes(closeStr);
  if (openMin < 0 || closeMin < 0) return null;
  return { openStr, closeStr, openMin, closeMin };
}

export function isRestaurantOpen(hoursStr: string, timezone: string): boolean {
  const range = parseRange(hoursStr);
  if (!range) return true; // unparseable → assume open
  const now = nowMinutes(timezone);
  const { openMin, closeMin } = range;
  return openMin <= closeMin
    ? now >= openMin && now < closeMin          // normal: 11am–11pm
    : now >= openMin || now < closeMin;         // cross-midnight: 9pm–2am
}

export function closedMessage(businessName: string, hoursStr: string): string {
  const range = parseRange(hoursStr);
  const display = range ? `${range.openStr} - ${range.closeStr}` : hoursStr;
  return (
    `🕐 Maaf kijiye, abhi *${businessName}* band hai.\n\n` +
    `Hamare hours: *${display}*\n\n` +
    `${range ? range.openStr : 'Opening time'} ko dobara try karein! 🙏`
  );
}
