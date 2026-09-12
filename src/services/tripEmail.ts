import { minutesToLabel } from './geo';
import { fetchPlacePhotoUrls } from './placePhotos';
import type { DayItinerary, ItineraryStop, TripInput } from '../types';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildTripEmailBody(
  input: TripInput,
  itinerary: DayItinerary[],
): string {
  const lines: string[] = [
    `Your trip to ${input.destination_city}`,
    `${itinerary.length} day${itinerary.length === 1 ? '' : 's'} · starting ${input.start_date}`,
    '',
  ];

  if (input.hotel_address) {
    lines.push(`Stay: ${input.hotel_address}`, '');
  }

  for (const day of itinerary) {
    const sights = day.stops.filter((s) => !s.is_meal);
    lines.push(`Day ${day.day_number} (${day.date})`);
    if (!sights.length) {
      lines.push('  (no places yet)', '');
      continue;
    }
    for (const stop of sights) {
      lines.push(`  • ${stop.name} — ${minutesToLabel(stop.duration_min)}`);
      if (stop.description) {
        lines.push(`    ${stop.description}`);
      }
    }
    lines.push('');
  }

  lines.push('—', 'Sent from Travel Agent');
  return lines.join('\n');
}

/** Absolute https image URL safe for email clients. */
function emailSafeImageUrl(url?: string | null): string | null {
  if (!url || !/^https:\/\//i.test(url)) return null;
  // Prefer a modest width for Commons Special:FilePath
  if (/commons\.wikimedia\.org\/wiki\/Special:FilePath/i.test(url)) {
    const u = new URL(url);
    u.searchParams.set('width', '240');
    return u.toString();
  }
  return url;
}

async function coverForStop(
  stop: ItineraryStop,
  city: string,
): Promise<string | null> {
  const existing = emailSafeImageUrl(stop.image_url);
  if (existing) return existing;

  try {
    const urls = await fetchPlacePhotoUrls(
      stop.name,
      city,
      stop.category,
      stop.lat,
      stop.lon,
      { imageUrl: stop.image_url },
    );
    return emailSafeImageUrl(urls[0] ?? null);
  } catch {
    return null;
  }
}

export async function buildTripEmailHtml(
  input: TripInput,
  itinerary: DayItinerary[],
): Promise<string> {
  const city = input.destination_city;
  const parts: string[] = [
    `<div style="font-family:Georgia,'Times New Roman',serif;color:#1a2e2b;max-width:560px;margin:0 auto;">`,
    `<h1 style="font-size:22px;margin:0 0 6px;">Your trip to ${escapeHtml(city)}</h1>`,
    `<p style="margin:0 0 18px;color:#5a6e6a;font-size:14px;font-family:Helvetica,Arial,sans-serif;">`,
    `${itinerary.length} day${itinerary.length === 1 ? '' : 's'} · starting ${escapeHtml(input.start_date)}`,
  ];

  if (input.hotel_address) {
    parts.push(
      `<br/>Stay: ${escapeHtml(input.hotel_address)}`,
    );
  }
  parts.push(`</p>`);

  for (const day of itinerary) {
    const sights = day.stops.filter((s) => !s.is_meal);
    parts.push(
      `<h2 style="font-size:17px;margin:22px 0 10px;border-bottom:1px solid #d5e0dd;padding-bottom:6px;">`,
      `Day ${day.day_number}`,
      `<span style="font-weight:normal;color:#5a6e6a;font-size:13px;font-family:Helvetica,Arial,sans-serif;"> · ${escapeHtml(day.date)}</span>`,
      `</h2>`,
    );

    if (!sights.length) {
      parts.push(
        `<p style="color:#5a6e6a;font-size:13px;font-family:Helvetica,Arial,sans-serif;">No places yet.</p>`,
      );
      continue;
    }

    for (const stop of sights) {
      const img = await coverForStop(stop, city);
      parts.push(
        `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 14px;border:1px solid #e2ebe8;border-radius:12px;overflow:hidden;">`,
        `<tr>`,
      );

      if (img) {
        parts.push(
          `<td style="width:112px;vertical-align:top;">`,
          `<img src="${escapeHtml(img)}" alt="${escapeHtml(stop.name)}" width="112" height="84" style="display:block;width:112px;height:84px;object-fit:cover;" />`,
          `</td>`,
        );
      }

      parts.push(
        `<td style="padding:10px 12px;vertical-align:top;font-family:Helvetica,Arial,sans-serif;">`,
        `<div style="font-weight:700;font-size:15px;margin:0 0 4px;">${escapeHtml(stop.name)}</div>`,
        `<div style="color:#5a6e6a;font-size:12px;margin:0 0 6px;">${escapeHtml(minutesToLabel(stop.duration_min))}</div>`,
        stop.description
          ? `<div style="color:#3d524e;font-size:13px;line-height:1.4;">${escapeHtml(stop.description)}</div>`
          : '',
        `</td></tr></table>`,
      );
    }
  }

  parts.push(
    `<p style="margin:24px 0 0;color:#5a6e6a;font-size:12px;font-family:Helvetica,Arial,sans-serif;">Sent from Travel Agent</p>`,
    `</div>`,
  );

  return parts.join('');
}

export function buildTripEmail(input: TripInput, itinerary: DayItinerary[]) {
  const subject = `Your ${itinerary.length}-day plan for ${input.destination_city}`;
  const body = buildTripEmailBody(input, itinerary);
  return { subject, body };
}

export type SendTripEmailResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Sends an HTML itinerary (with small place photos) to the traveler’s inbox.
 * Uses FormSubmit’s free tier — no cost for typical personal use.
 * First-time addresses may get a one-click activation email.
 */
export async function sendTripPlanEmail(
  to: string,
  input: TripInput,
  itinerary: DayItinerary[],
): Promise<SendTripEmailResult> {
  const trimmed = to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }

  const { subject, body } = buildTripEmail(input, itinerary);
  const html = await buildTripEmailHtml(input, itinerary);

  try {
    const res = await fetch(
      `https://formsubmit.co/ajax/${encodeURIComponent(trimmed)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Travel Agent',
          _subject: subject,
          // HTML body with thumbnails; plain text as fallback field
          message: html,
          _template: 'blank',
          _captcha: 'false',
          plain: body,
        }),
      },
    );

    const data = (await res.json().catch(() => null)) as {
      success?: string | boolean;
      message?: string;
    } | null;

    if (!res.ok) {
      return {
        ok: false,
        error:
          data?.message ||
          'Couldn’t send the email right now. Try again in a moment.',
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'Network error — check your connection and try again.',
    };
  }
}
