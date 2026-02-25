'use strict';

/**
 * An asynchronous bootstrap function that runs before
 * your application gets started.
 *
 * This gives you an opportunity to set up your data model,
 * run jobs, or perform some special logic.
 */

module.exports = async ({ strapi }) => {
  // Register public permissions for tierlist-changelog
  const publicRole = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });

  if (publicRole) {
    const permissions = await strapi.query('plugin::users-permissions.permission').findMany({
      where: {
        role: publicRole.id,
        action: {
          $in: [
            'api::tierlist-changelog.tierlist-changelog.find',
            'api::tierlist-changelog.tierlist-changelog.findOne',
          ],
        },
      },
    });

    if (permissions.length === 0) {
      await strapi.query('plugin::users-permissions.permission').createMany({
        data: [
          {
            action: 'api::tierlist-changelog.tierlist-changelog.find',
            role: publicRole.id,
          },
          {
            action: 'api::tierlist-changelog.tierlist-changelog.findOne',
            role: publicRole.id,
          },
        ],
      });
    }
  }
};
