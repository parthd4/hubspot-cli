// @ts-nocheck
const { promptUser } = require('./promptUtils');
const { i18n } = require('../lang');
const { uiAccountDescription } = require('../ui');

const mapAccountChoices = portals =>
  portals.map(p => ({
    name: uiAccountDescription(p.portalId, false),
    value: p.name || p.portalId,
  }));

const i18nKey = 'commands.accounts.subcommands.use';

const selectAccountFromConfig = async (config, prompt) => {
  const { default: selectedDefault } = await promptUser([
    {
      type: 'list',
      look: false,
      name: 'default',
      pageSize: 20,
      message: prompt || i18n(`${i18nKey}.promptMessage`),
      choices: mapAccountChoices(config.portals),
      default: config.defaultPortal,
    },
  ]);

  return selectedDefault;
};

module.exports = {
  selectAccountFromConfig,
};
