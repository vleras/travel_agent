import emailjs from '@emailjs/browser';
import type { DayItinerary, ItineraryStop, TripInput } from '../types';
import { clearWeatherCache, getWeatherForItinerary } from './weather';

interface TripBaseLocation {
  lat: number;
  lon: number;
}

/** Google Maps search link for a stop (lat/lon). */
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
  const endDate = new Date(itinerary[itinerary.length - 1].date);
  const dateRange = itinerary.length === 1
    ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const daysHtml = itinerary.map((day) => {
    const sights = day.stops.filter((s) => !s.is_meal);
    const meals = day.stops.filter((s) => s.is_meal);

    let dayHtml = `<h3 style="margin: 1.5rem 0 0.5rem; font-size: 16px; font-weight: 600; color: #1f6f68;">Day ${day.day_number} – ${day.date}</h3>\n`;

    if (sights.length === 0) {
      dayHtml += '<p style="margin: 0; color: #666; font-size: 14px;">No activities planned</p>\n';
    } else {
      dayHtml += '<ul style="margin: 0.5rem 0; padding-left: 20px; color: #333; font-size: 14px;">\n';
      sights.forEach((stop) => {
        const mapsUrl = googleMapsUrl(stop);
        dayHtml += `  <li style="margin: 0.25rem 0;"><a href="${mapsUrl}" style="color: #2a6f9e; text-decoration: none;">${stop.name}</a></li>\n`;
      });
      dayHtml += '</ul>\n';
    }

    if (meals.length > 0) {
      meals.forEach((meal) => {
        const mealType = meal.category === 'Restaurants' || meal.name.toLowerCase().includes('dinner') ? 'Dinner' :
                         meal.category === 'Cafés' || meal.name.toLowerCase().includes('breakfast') || meal.name.toLowerCase().includes('cafe') ? 'Breakfast' :
                         'Lunch';
        dayHtml += `<p style="margin: 0.25rem 0; font-size: 14px; color: #666;">${mealType} at <strong>${meal.name}</strong></p>\n`;
      });
    }

    const routeLink = buildDayRouteLink(day.stops, base);
    if (routeLink) {
      dayHtml += `<p style="margin: 0.5rem 0 0; font-size: 13px;"><a href="${routeLink}" style="color: #2a6f9e; text-decoration: none;">Open today's route in Google Maps →</a></p>\n`;
    }

    return dayHtml;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your ${itinerary.length}-day trip to ${input.destination_city}</title>
</head>
<body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333;">
  <h1 style="margin: 0 0 0.5rem; font-size: 28px; font-weight: 700; color: #1f6f68;">${input.destination_city}</h1>
  <p style="margin: 0 0 1rem; font-size: 14px; color: #666;">${itinerary.length} day${itinerary.length === 1 ? '' : 's'} • ${dateRange}${input.hotel_address ? ` • Stay: ${input.hotel_address}` : ''}</p>

  ${daysHtml}

  <p style="margin: 2rem 0 0; padding-top: 1rem; border-top: 1px solid #ddd; font-size: 12px; color: #999;">Made with Travel Agent</p>
</body>
</html>`;

  return html;
}

function buildTripEmailText(
  input: TripInput,
  itinerary: DayItinerary[],
  _base: TripBaseLocation,
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

    lines.push(`Day ${day.day_number} – ${day.date}`);

    if (sights.length === 0) {
      lines.push('  (no activities planned)');
    } else {
      sights.forEach((stop) => {
        lines.push(`  • ${stop.name}`);
      });
    }

    if (meals.length > 0) {
      meals.forEach((meal) => {
        const mealType = meal.category === 'Restaurants' ? 'Dinner' :
                        meal.category === 'Cafés' ? 'Breakfast' :
                        'Lunch';
        lines.push(`  ${mealType} at ${meal.name}`);
      });
    }

    lines.push('');
  }

  lines.push('Made with Travel Agent');
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

  // Clear cache and fetch fresh weather data before building email
  clearWeatherCache();
  const dates = itinerary.map(day => day.date);
  const freshWeather = await getWeatherForItinerary(base.lat, base.lon, dates);
  const freshItinerary = itinerary.map(day => {
    const weather = freshWeather.find(w => w.date === day.date);
    return { ...day, weather };
  });

  const subject = `Your ${itinerary.length}-day plan for ${input.destination_city}`;
  const tripHtml = buildTripEmailHTML(input, freshItinerary, base);
  const tripText = buildTripEmailText(input, freshItinerary, base);

  const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
  const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
  const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

  // Try EmailJS first if configured
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
      console.error('EmailJS send failed:', error);
      // Fall through to FormSubmit if EmailJS fails
    }
  }

  // Fallback to FormSubmit (free, no configuration needed)
  try {
    const formData = new FormData();
    formData.append('email', trimmed);
    formData.append('subject', subject);
    formData.append('message', tripText);
    formData.append('_subject', subject);

    const response = await fetch('https://formsubmit.co/ajax/travel-itinerary@noreply.local', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`FormSubmit returned ${response.status}`);
    }

    return { ok: true };
  } catch (error) {
    console.error('Email send failed:', error);
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to send email. Try again in a moment.',
    };
  }
}
