// @ts-nocheck
const { logger } = require('@hubspot/local-dev-lib/logger');
const { createModule } = require('@hubspot/local-dev-lib/cms/modules');
const { i18n } = require('../../lib/lang');
const { createModulePrompt } = require('../../lib/prompts/createModulePrompt');
const { logError } = require('../../lib/errorHandlers/index');
const { EXIT_CODES } = require('../../lib/enums/exitCodes');

const i18nKey = 'commands.create.subcommands.module';

module.exports = {
  dest: ({ dest }) => dest,
  validate: ({ name }) => {
    if (!name) {
      logger.error(i18n(`${i18nKey}.errors.nameRequired`));
      return false;
    }
    return true;
  },
  execute: async ({ name, dest, getInternalVersion }) => {
    const moduleDefinition = await createModulePrompt();
    try {
      await createModule(moduleDefinition, name, dest, getInternalVersion);
    } catch (e) {
      logError(e);
      process.exit(EXIT_CODES.ERROR);
    }
  },
};
