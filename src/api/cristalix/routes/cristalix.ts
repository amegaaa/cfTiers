/**
 * Cristalix routes
 */

export default {
  routes: [
    {
      // ГЛАВНЫЙ endpoint - все скины одним запросом
      method: 'GET',
      path: '/cristalix/skins',
      handler: 'cristalix.getAllSkins',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/cristalix/skin/:username',
      handler: 'cristalix.getSkin',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/cristalix/uuid/:username',
      handler: 'cristalix.getUUID',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/cristalix/batch-uuids',
      handler: 'cristalix.batchGetUUIDs',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'DELETE',
      path: '/cristalix/cache',
      handler: 'cristalix.clearCache',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/cristalix/cache-stats',
      handler: 'cristalix.getCacheStats',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};