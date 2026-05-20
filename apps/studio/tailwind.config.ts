import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0F1A",
        ink: "#FFFFFF",
        accent: "#00FF85",
        gold: "#FFD700",
      },
    },
  },
  plugins: [],
};

export default config;
