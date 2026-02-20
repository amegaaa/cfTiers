/**
 * Cristalix controller
 */

export default {

  /**
   * GET /api/cristalix/health
   * Проверка работоспособности сервиса
   */
  async health(ctx) {
    const stats = strapi.service('api::cristalix.cristalix').getCacheStats();
    return ctx.send({
      status: 'ok',
      cache: {
        size: stats.size,
        uptime: process.uptime(),
      },
    });
  },

  /**
   * GET /api/cristalix/skins
   * Получить скины для ВСЕХ игроков из базы одним запросом
   * Это главный endpoint — вызывается один раз при загрузке страницы
   */
  async getAllSkins(ctx) {
    try {
      // Достаём всех игроков из базы Strapi
      const players = await strapi.documents('api::player.player').findMany({
        fields: ['username'],
        status: 'published',
      });

      const usernames = players
        .map((p: any) => p.username)
        .filter(Boolean);

      if (usernames.length === 0) {
        return ctx.send({ skins: {} });
      }

      // Один пакетный запрос для всех
      const profiles = await strapi
        .service('api::cristalix.cristalix')
        .batchGetProfiles(usernames);

      // Формируем ответ: { "ник": { uuid, skinUrl } }
      const skins: Record<string, { uuid: string; skinUrl: string }> = {};
      profiles.forEach((data, username) => {
        skins[username] = data;
      });

      return ctx.send({
        total: usernames.length,
        loaded: Object.keys(skins).length,
        skins,
      });

    } catch (error) {
      strapi.log.error('Error in getAllSkins:', error);
      // Возвращаем пустой ответ вместо 500, чтобы фронт не падал
      return ctx.send({
        total: 0,
        loaded: 0,
        skins: {},
        error: 'Failed to fetch skins, using default avatars',
      });
    }
  },

  /**
   * GET /api/cristalix/skin/:username
   * Получить скин одного игрока (для отдельных случаев)
   */
  async getSkin(ctx) {
    const { username } = ctx.params;

    if (!username) {
      return ctx.badRequest('Username is required');
    }

    try {
      const skinData = await strapi
        .service('api::cristalix.cristalix')
        .getSkinByUsername(username);

      if (!skinData.uuid) {
        return ctx.notFound(`Player ${username} not found`);
      }

      return ctx.send({
        username,
        uuid: skinData.uuid,
        skinUrl: skinData.skinUrl,
        headUrl: skinData.headUrl,
      });

    } catch (error) {
      strapi.log.error('Error in getSkin:', error);
      return ctx.internalServerError('Failed to fetch skin data');
    }
  },

  /**
   * GET /api/cristalix/uuid/:username
   * Совместимость со старым кодом
   */
  async getUUID(ctx) {
    const { username } = ctx.params;

    if (!username) {
      return ctx.badRequest('Username is required');
    }

    try {
      const skinData = await strapi
        .service('api::cristalix.cristalix')
        .getSkinByUsername(username);

      if (!skinData.uuid) {
        return ctx.notFound(`Player ${username} not found`);
      }

      return ctx.send({
        username,
        uuid: skinData.uuid,
        skinUrl: skinData.skinUrl,
        headUrl: skinData.headUrl,
      });

    } catch (error) {
      strapi.log.error('Error in getUUID:', error);
      return ctx.internalServerError('Failed to fetch UUID');
    }
  },

  async batchGetUUIDs(ctx) {
    const { usernames } = ctx.request.body;

    if (!Array.isArray(usernames) || usernames.length === 0) {
      return ctx.badRequest('Usernames array is required');
    }

    if (usernames.length > 50) {
      return ctx.badRequest('Maximum 50 usernames per request');
    }

    try {
      const profiles = await strapi
        .service('api::cristalix.cristalix')
        .batchGetProfiles(usernames);

      const result: Record<string, any> = {};
      profiles.forEach((data, username) => {
        result[username] = data;
      });

      return ctx.send({
        count: profiles.size,
        players: result,
      });

    } catch (error) {
      strapi.log.error('Error in batchGetUUIDs:', error);
      return ctx.internalServerError('Failed to fetch UUIDs');
    }
  },

  async clearCache(ctx) {
    strapi.service('api::cristalix.cristalix').clearCache();
    return ctx.send({ success: true, message: 'Cache cleared' });
  },

  async getCacheStats(ctx) {
    const stats = strapi.service('api::cristalix.cristalix').getCacheStats();
    return ctx.send(stats);
  },
};