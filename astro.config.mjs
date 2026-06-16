// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://nlefterova.github.io',
  base: '/Houseboat-website',
  vite: {
    plugins: [tailwindcss()]
  }
});