import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./game/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { neon: "#22d3ee", rival: "#f43f5e" },
      fontFamily: { display: ["Orbitron", "ui-sans-serif", "system-ui"] },
      screens: {
        // phone held sideways / any very short viewport: compact HUD
        short: { raw: "(max-height: 520px)" },
        // finger-driven device (phones, tablets)
        touch: { raw: "(pointer: coarse)" },
        // laptop / desktop with room for the full HUD
        tall: { raw: "(min-height: 521px)" },
      },
    },
  },
  plugins: [],
} satisfies Config;
