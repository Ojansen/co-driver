// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@nuxt/scripts',
    '@nuxt/test-utils',
    '@vueuse/nuxt',
    '@nuxthub/core',
    '@tresjs/nuxt'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  colorMode: {
    preference: 'dark',
    fallback: 'dark'
  },

  devServer: {
    port: Number(process.env.NUXT_DEV_PORT) || 3000,
    host: process.env.NUXT_DEV_HOST || '0.0.0.0'
  },

  compatibilityDate: '2025-01-15',

  nitro: {
    experimental: {
      websocket: true
    }
  },

  hub: {
    // The docker image runs docker/migrate.mjs on startup; build-time migration
    // is redundant and trips up clean-room builds (e.g. multi-stage Docker).
    db: {
      dialect: 'sqlite',
      applyMigrationsDuringBuild: false
    }
  },

  vite: {
    optimizeDeps: {
      include: [
        '@vue/devtools-core',
        '@vue/devtools-kit'
      ]
    },
    server: {
      allowedHosts: true
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
