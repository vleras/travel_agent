import emailjs from '@emailjs/browser';
import { haversineKm } from './geo';
import type { DayItinerary, ItineraryStop, TripInput } from '../types';

interface TripBaseLocation {
  lat: number;
  lon: number;
}

function calculateWalkingTime(km: number): string {
  // Assume ~1.4 m/s average walking speed
  const minutes = Math.round((km * 1000) / 1.4 / 60);
  if (minutes < 1) return '< 1 min';
  if (minutes === 1) return '1 min';
  return `${minutes} min`;
}

function getWalkingDistance(from: ItineraryStop, to: ItineraryStop): { km: number; time: string } {
  const km = haversineKm(from.lat, from.lon, to.lat, to.lon);
  return { km, time: calculateWalkingTime(km) };
}

/** Google Maps pin for a stop (lat/lon). */
export function googleMapsUrl(stop: Pick<ItineraryStop, 'lat' | 'lon' | 'name'>): string {
  const q = `${stop.lat},${stop.lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function buildDayRouteLink(stops: ItineraryStop[], base: TripBaseLocation): string {
  const sights = stops.filter((s) => !s.is_meal);
  if (!sights.length) return '';

  const origin = `${base.lat},${base.lon}`;
  const destination = `${sights[sights.length - 1].lat},${sights[sights.length - 1].lon}`;
  const waypoints = sights.slice(0, -1).map((s) => `${s.lat},${s.lon}`).join('|');

  const params = new URLSearchParams({
    api: '1',
    origin,
    destination,
    ...(waypoints && { waypoints }),
  });

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function buildTripEmailHTML(
  input: TripInput,
  itinerary: DayItinerary[],
  base: TripBaseLocation,
): string {
  const startDate = new Date(input.start_date);
  const dateRange = itinerary.length === 1
    ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(itinerary[itinerary.length - 1].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const primaryColor = '#1f6f68';
  const accentColor = '#2a6f9e';
  const lightGray = '#f7f7f7';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your ${itinerary.length}-day trip to ${input.destination_city}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #ffffff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table width="100%" maxwidth="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
          <!-- Header -->
          <tr>
            <td style="padding: 30px; background: linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%); color: white; text-align: center; border-radius: 12px 12px 0 0;">
              <h1 style="margin: 0 0 8px 0; font-size: 32px; font-weight: 700;">${input.destination_city}</h1>
              <p style="margin: 0 0 12px 0; font-size: 14px; opacity: 0.9;">${itinerary.length} day${itinerary.length === 1 ? '' : 's'} • ${dateRange}</p>
              ${input.hotel_address ? `<p style="margin: 0; font-size: 13px; opacity: 0.85;">Stay: ${input.hotel_address}</p>` : ''}
            </td>
          </tr>

          <!-- Days -->
          ${itinerary.map((day) => {
            const sights = day.stops.filter((s) => !s.is_meal);
            const meals = day.stops.filter((s) => s.is_meal);
            const hasContent = sights.length > 0;

            if (!hasContent) {
              return `<tr><td style="padding: 20px 30px; color: #999; font-size: 14px;">Day ${day.day_number} (${day.date}) — No activities planned</td></tr>`;
            }

            const dayTitle = sights.slice(0, 2).map((s) => s.name).join(' • ');
            const routeLink = buildDayRouteLink(day.stops, base);

            return `<tr>
              <td style="padding: 30px; border-bottom: 1px solid ${lightGray};">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-bottom: 16px;">
                      <h2 style="margin: 0 0 4px 0; font-size: 18px; font-weight: 600; color: ${primaryColor};">Day ${day.day_number}</h2>
                      <p style="margin: 0; font-size: 12px; color: #999;">${day.date}</p>
                    </td>
                  </tr>

                  <!-- Stops -->
                  ${sights.map((stop, idx) => {
                    const nextStop = sights[idx + 1];
                    const walking = nextStop ? getWalkingDistance(stop, nextStop) : null;

                    return `<tr>
                      <td style="padding: 12px 0;">
                        <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 500; color: #1a1a1a;">
                          <strong>${stop.time_slot}</strong> ${stop.name}
                        </p>
                        <p style="margin: 0 0 6px 0; font-size: 13px; color: #666; line-height: 1.4;">${stop.description}</p>
                        <a href="${googleMapsUrl(stop)}" style="font-size: 12px; color: ${accentColor}; text-decoration: none; font-weight: 500;">View on Google Maps →</a>
                      </td>
                    </tr>
                    ${walking ? `<tr>
                      <td style="padding: 8px 0; font-size: 12px; color: #999;">↓ ${walking.time} walk</td>
                    </tr>` : ''}`;
                  }).join('')}

                  <!-- Meals -->
                  ${meals.length > 0 ? `<tr>
                    <td style="padding: 12px 0 0 0;">
                      ${meals.map((meal) => {
                        const mealType = meal.category === 'Restaurants' || meal.name.toLowerCase().includes('dinner') ? 'Dinner' :
                                       meal.category === 'Cafés' || meal.name.toLowerCase().includes('breakfast') || meal.name.toLowerCase().includes('cafe') ? 'Breakfast' :
                                       'Lunch';
                        return `<p style="margin: 0 0 4px 0; font-size: 13px; color: #666;">
                          ${mealType} at <strong>${meal.name}</strong>
                        </p>`;
                      }).join('')}
                    </td>
                  </tr>` : ''}

                  <!-- Route Button -->
                  ${routeLink ? `<tr>
                    <td style="padding: 16px 0 0 0;">
                      <table cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="background-color: ${primaryColor}; border-radius: 6px; padding: 10px 16px;">
                            <a href="${routeLink}" style="font-size: 13px; font-weight: 600; color: white; text-decoration: none; display: block;">Open today's route in Google Maps</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>` : ''}
                </table>
              </td>
            </tr>`;
          }).join('')}

          <!-- Footer -->
          <tr>
            <td style="padding: 30px; background-color: ${lightGray}; text-align: center; border-radius: 0 0 12px 12px; color: #666; font-size: 13px;">
              <p style="margin: 0;">Made with Travel Agent</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return html;
}

function buildTripEmailText(
  input: TripInput,
  itinerary: DayItinerary[],
  base: TripBaseLocation,
): string {
  const lines: string[] = [
    `Your ${itinerary.length}-day trip to ${input.destination_city}`,
    '',
  ];

  if (input.hotel_address) {
    lines.push(`Stay: ${input.hotel_address}`, '');
  }

  for (const day of itinerary) {
    const sights = day.stops.filter((s) => !s.is_meal);
    const meals = day.stops.filter((s) => s.is_meal);

    lines.push(`Day ${day.day_number} (${day.date})`);

    if (!sights.length) {
      lines.push('  (no activities planned)');
    } else {
      for (const stop of sights) {
        lines.push(`  • ${stop.time_slot} ${stop.name}`);
        lines.push(`    ${stop.description}`);
      }

      if (meals.length > 0) {
        lines.push('');
        meals.forEach((meal) => {
          const mealType = meal.category === 'Restaurants' ? 'Dinner' :
                          meal.category === 'Cafés' ? 'Breakfast' :
                          'Lunch';
          lines.push(`  ${mealType} at ${meal.name}`);
        });
      }
    }

    lines.push('');
  }

  lines.push('Sent from Travel Agent');
  return lines.join('\n');
}

export type SendTripEmailResult =
  | { ok: true }
  | { ok: false; error: string };

export async function sendTripPlanEmail(
  to: string,
  input: TripInput,
  itinerary: DayItinerary[],
  base: TripBaseLocation,
): Promise<SendTripEmailResult> {
  const trimmed = to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }

  const subject = `Your ${itinerary.length}-day plan for ${input.destination_city}`;
  const tripHtml = buildTripEmailHTML(input, itinerary, base);
  const tripText = buildTripEmailText(input, itinerary, base);

  // Try EmailJS first if configured
  const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
  const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
  const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

  if (serviceId && templateId && publicKey) {
    try {
      emailjs.init(publicKey);
      await emailjs.send(serviceId, templateId, {
        to_email: trimmed,
        trip_subject: subject,
        trip_html: tripHtml,
        trip_text: tripText,
      });
      return { ok: true };
    } catch (error) {
      console.error('EmailJS error:', error);
      // Fall back to FormSubmit if EmailJS fails
    }
  }

  // Fallback to FormSubmit
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
          message: tripText,
          _template: 'box',
          _captcha: 'false',
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
          'Couldn\'t send the email right now. Try again in a moment.',
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'Network error. Check your connection and try again.',
    };
  }
}
