interface WeatherForecast {
  date: string;
  temp_c: number;
  temp_f: number;
  condition: string;
  icon: string;
  maxTemp_c: number;
  minTemp_c: number;
  avgHumidity: number;
}

export interface DayWeather {
  date: string;
  temperature: number;
  condition: string;
  icon: string;
  maxTemp: number;
  minTemp: number;
  humidity: number;
}

async function fetchWeatherData(destination: string, startDate: string, endDate: string): Promise<WeatherForecast[]> {
  const apiKey = 'ca3e5db0e6d84ffaa8a182254252809'; // WeatherAPI.com free tier key

  try {
    // Calculate days needed
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysNeeded = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // WeatherAPI.com free tier supports up to 10 days forecast
    const days = Math.min(daysNeeded, 10);

    const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(destination)}&days=${days}&aqi=no`;

    const response = await fetch(url);
    if (!response.ok) {
      console.error('Weather API error:', response.status);
      return [];
    }

    const data = await response.json() as {
      forecast?: { forecastday?: Array<{ date: string; day: { avgtemp_c: number; condition: { text: string; icon: string }; maxtemp_c: number; mintemp_c: number; avghumidity: number } }> };
    };

    if (!data.forecast?.forecastday) {
      return [];
    }

    return data.forecast.forecastday.map((day) => ({
      date: day.date,
      temp_c: Math.round(day.day.avgtemp_c),
      temp_f: Math.round((day.day.avgtemp_c * 9 / 5) + 32),
      condition: day.day.condition.text,
      icon: day.day.condition.icon,
      maxTemp_c: Math.round(day.day.maxtemp_c),
      minTemp_c: Math.round(day.day.mintemp_c),
      avgHumidity: Math.round(day.day.avghumidity),
    }));
  } catch (error) {
    console.error('Failed to fetch weather:', error);
    return [];
  }
}

export async function getWeatherForItinerary(
  destination: string,
  startDate: string,
  endDate: string
): Promise<DayWeather[]> {
  const forecasts = await fetchWeatherData(destination, startDate, endDate);

  return forecasts.map((f) => ({
    date: f.date,
    temperature: f.temp_c,
    condition: f.condition,
    icon: f.icon,
    maxTemp: f.maxTemp_c,
    minTemp: f.minTemp_c,
    humidity: f.avgHumidity,
  }));
}
