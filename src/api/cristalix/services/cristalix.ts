/**
 * Cristalix service — пакетная загрузка профилей игроков
 * Один запрос вместо N запросов → не превышаем лимит 120/мин
 */

interface PlayerProfile {
  uuid: string;
  skinUrl: string;
  timestamp: number;
}

// Кэш: ник → профиль (живёт 1 час)
const playerCache = new Map<string, PlayerProfile>();
const CACHE_DURATION = 3600000;

const CRISTALIX_API = {
  baseUrl: 'https://api.cristalix.gg',
  // ТОЛЬКО из переменных окружения — без захардкоженных значений!
  get projectKey() { return process.env.CRISTALIX_PROJECT_KEY || ''; },
  get token() { return process.env.CRISTALIX_TOKEN || ''; },
};

export default () => ({

  /**
   * ПАКЕТНАЯ загрузка профилей для массива ников
   */
  async batchGetProfiles(usernames: string[]): Promise<Map<string, { uuid: string; skinUrl: string }>> {
    const result = new Map<string, { uuid: string; skinUrl: string }>();
    const toFetch: string[] = [];

    // Берём из кэша то что уже есть
    for (const username of usernames) {
      const cached = playerCache.get(username.toLowerCase());
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        result.set(username, { uuid: cached.uuid, skinUrl: cached.skinUrl });
      } else {
        toFetch.push(username);
      }
    }

    if (toFetch.length === 0) {
      strapi.log.info(`Cristalix: все ${usernames.length} игроков из кэша`);
      return result;
    }

    strapi.log.info(`Cristalix: загружаем ${toFetch.length} игроков, ${usernames.length - toFetch.length} из кэша`);

    // Разбиваем на чанки по 50 (лимит API)
    const chunks: string[][] = [];
    for (let i = 0; i < toFetch.length; i += 50) {
      chunks.push(toFetch.slice(i, i + 50));
    }

    for (const chunk of chunks) {
      try {
        const url = `${CRISTALIX_API.baseUrl}/players/v1/getProfilesByNames?project_key=${CRISTALIX_API.projectKey}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${CRISTALIX_API.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ array: chunk }),
        });

        if (!response.ok) {
          strapi.log.error(`Cristalix batch error: ${response.status} ${response.statusText}`);
          continue;
        }

        const data: any = await response.json();
        const profiles: any[] = Array.isArray(data) ? data : [];

        for (const profile of profiles) {
          const username = profile?.username;
          const uuid = profile?.id;
          const skinUrl = profile?.textures?.skin;

          if (!username || !uuid || !skinUrl) continue;

          playerCache.set(username.toLowerCase(), {
            uuid,
            skinUrl,
            timestamp: Date.now(),
          });

          result.set(username, { uuid, skinUrl });
        }

        strapi.log.info(`Cristalix: загружено ${profiles.length} профилей из чанка ${chunk.length}`);

      } catch (error) {
        strapi.log.error(`Cristalix batch chunk error:`, error);
      }
    }

    return result;
  },

  /**
   * Получить профиль одного игрока (использует кэш)
   */
  async getSkinByUsername(username: string): Promise<{ uuid: string | null; skinUrl: string | null; headUrl: string | null }> {
    if (!username) return { uuid: null, skinUrl: null, headUrl: null };

    // Проверяем кэш
    const cached = playerCache.get(username.toLowerCase());
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return { uuid: cached.uuid, skinUrl: cached.skinUrl, headUrl: cached.skinUrl };
    }

    try {
      const url = `${CRISTALIX_API.baseUrl}/players/v1/getProfileByName?playerName=${encodeURIComponent(username)}&project_key=${CRISTALIX_API.projectKey}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${CRISTALIX_API.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        strapi.log.warn(`Cristalix: не найден игрок ${username}: ${response.status}`);
        return { uuid: null, skinUrl: null, headUrl: null };
      }

      const data: any = await response.json();
      const uuid = data?.id;
      const skinUrl = data?.textures?.skin;

      if (!uuid || !skinUrl) {
        return { uuid: null, skinUrl: null, headUrl: null };
      }

      playerCache.set(username.toLowerCase(), { uuid, skinUrl, timestamp: Date.now() });

      return { uuid, skinUrl, headUrl: skinUrl };

    } catch (error) {
      strapi.log.error(`Cristalix одиночный запрос для ${username}:`, error);
      return { uuid: null, skinUrl: null, headUrl: null };
    }
  },

  async getPlayerUUID(username: string): Promise<string | null> {
    const result = await this.getSkinByUsername(username);
    return result.uuid;
  },

  clearCache(): void {
    playerCache.clear();
    strapi.log.info('Cristalix cache cleared');
  },

  getCacheStats() {
    const now = Date.now();
    return {
      size: playerCache.size,
      entries: Array.from(playerCache.entries()).map(([username, data]) => ({
        username,
        uuid: data.uuid,
        ageSeconds: Math.floor((now - data.timestamp) / 1000),
      })),
    };
  },
});