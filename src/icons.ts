// Lucide selbst gebündelt (ISC, kein Icon CDN). Die kebab-case Namen aus
// wmo.ts passen direkt auf data-lucide Attribute; nach jedem Rendern
// renderIcons() aufrufen, damit createIcons() neue Knoten ersetzt.
import {
  createIcons,
  Sun,
  Moon,
  Cloud,
  CloudSun,
  CloudMoon,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSunRain,
  CloudMoonRain,
  CloudLightning,
  CloudHail,
  Snowflake,
  Search,
  MapPin,
  Star,
  X,
  Droplets,
  Wind,
  Thermometer,
  RefreshCw,
  Umbrella,
  Sunrise,
  Sunset,
} from "lucide";

const icons = {
  Sun,
  Moon,
  Cloud,
  CloudSun,
  CloudMoon,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSunRain,
  CloudMoonRain,
  CloudLightning,
  CloudHail,
  Snowflake,
  Search,
  MapPin,
  Star,
  X,
  Droplets,
  Wind,
  Thermometer,
  RefreshCw,
  Umbrella,
  Sunrise,
  Sunset,
};

export function renderIcons(): void {
  createIcons({
    icons,
    attrs: { "aria-hidden": "true", focusable: "false" },
  });
}
