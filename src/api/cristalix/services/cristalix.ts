/**
 * Cristalix service — пакетная загрузка профилей игроков
 * Использует undici для HTTP/2 (Cristalix требует HTTP/2+)
 */

import { fetch as undiciFetch } from 'undici';

interface PlayerProfile {
  uuid: string;
  skinUrl: string;
  timestamp: number;
}

const playerCache = new Map<string, PlayerProfile>();
const CACHE_DURATION = 3600000;

const CRISTALIX_API = {
  baseUrl: 'https://api.cristalix.gg',
  projectKey: process.env.CRISTALIX_PROJECT_KEY || 'ef3d0649-386d-46c6-b65e-10801912ab57',
  token: process.env.CRISTALIX_TOKEN || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJjSSI6IjJmMmFlZjM4LWEyNjAtMTFlZC05ZDQyLTFjYjcyY2IwMTRhZSIsInBJeSI6ImVmM2QwNjQ5LTM4NmQtNDZjNi1iNjVlLTEwODAxOTEyYWI1NyIsInNJIjoiMWZiOTNmN2MtODE0NS00Zjk1LTllY2MtOWE2MjM2MmYxNDZlIiwiaWF0IjoxNzcxMjU1MzczLCJpc3MiOiJDcmlzdGFsaXhPcGVuQXBpIn0.vmA2l_gNfRrK6fCKRsz95rTHGKf7s1UTHXOmsrcCq4c',
};

const getHeaders = () => ({
  'Authorization': `Bearer ${CRISTALIX_API.token}`,
  'Content-Type': 'application/json',
});

export default () => ({

  async batchGetProfiles(usernames: string[]): Promise<Map<string, { uuid: string; skinUrl: string }>> {
    const result = new Map<string, { uuid: string; skinUrl: string }>();
    const toFetch: string[] = [];

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

    strapi.log.info(`Cristalix: загружаем ${toFetch.length} игроков`);

    const chunks: string[][] = [];
    for (let i = 0; i < toFetch.length; i += 50) {
      chunks.push(toFetch.slice(i, i + 50));
    }

    for (const chunk of chunks) {
      try {
        const url = `${CRISTALIX_API.baseUrl}/players/v1/getProfilesByNames?project_key=${CRISTALIX_API.projectKey}`;

        const response = await undiciFetch(url, {
          method: 'POST',
          headers: getHeaders(),
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

        strapi.log.info(`Cristalix: загружено ${profiles.length} из ${chunk.length}`);

      } catch (error) {
        strapi.log.error(`Cristalix batch error:`, error);
      }
    }

    return result;
  },

  async getSkinByUsername(username: string): Promise<{ uuid: string | null; skinUrl: string | null; headUrl: string | null }> {
    if (!username) return { uuid: null, skinUrl: null, headUrl: null };

    const cached = playerCache.get(username.toLowerCase());
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return { uuid: cached.uuid, skinUrl: cached.skinUrl, headUrl: cached.skinUrl };
    }

    try {
      const url = `${CRISTALIX_API.baseUrl}/players/v1/getProfileByName?playerName=${encodeURIComponent(username)}&project_key=${CRISTALIX_API.projectKey}`;

      const response = await undiciFetch(url, {
        method: 'GET',
        headers: getHeaders(),
      });

      if (!response.ok) {
        strapi.log.warn(`Cristalix: не найден ${username}: ${response.status}`);
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
      strapi.log.error(`Cristalix error for ${username}:`, error);
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