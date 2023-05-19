const chokidar = require('chokidar');
const path = require('path');
const { default: PQueue } = require('p-queue');
const { i18n } = require('./lang');
const { logger } = require('@hubspot/cli-lib/logger');
const {
  isSpecifiedError,
} = require('@hubspot/cli-lib/errorHandlers/apiErrors');
const { handleKeypress } = require('@hubspot/cli-lib/lib/process');
const {
  logApiErrorInstance,
  ApiErrorContext,
} = require('@hubspot/cli-lib/errorHandlers');
const { ERROR_TYPES } = require('@hubspot/cli-lib/lib/constants');
const { isAllowedExtension } = require('@hubspot/cli-lib/path');
const { shouldIgnoreFile } = require('@hubspot/cli-lib/ignoreRules');
const {
  cancelStagedBuild,
  uploadFileToBuild,
  deleteFileFromBuild,
  provisionBuild,
  queueBuild,
} = require('@hubspot/cli-lib/api/dfs');
const SpinniesManager = require('./SpinniesManager');
const DevServerManager = require('./DevServerManager');
const { EXIT_CODES } = require('./enums/exitCodes');
const { pollProjectBuildAndDeploy } = require('./projects');
const { uiAccountDescription, uiLink } = require('./ui');

const i18nKey = 'cli.lib.LocalDevManager';

const BUILD_DEBOUNCE_TIME = 3500;

const WATCH_EVENTS = {
  add: 'add',
  change: 'change',
  unlink: 'unlink',
  unlinkDir: 'unlinkDir',
};

const UPLOAD_PERMISSIONS = {
  always: 'always',
  manual: 'manual',
  never: 'never',
};

class LocalDevManager {
  constructor(options) {
    this.targetAccountId = options.targetAccountId;
    this.projectConfig = options.projectConfig;
    this.projectDir = options.projectDir;
    this.port = options.port;
    this.uploadPermission =
      options.uploadPermission || UPLOAD_PERMISSIONS.always;
    this.debug = options.debug || false;

    this.projectSourceDir = path.join(
      this.projectDir,
      this.projectConfig.srcDir
    );
    this.spinnies = null;
    this.watcher = null;
    this.uploadQueue = null;
    this.standbyChanges = [];
    this.debouncedBuild = null;
    this.currentStagedBuildId = null;

    if (!this.targetAccountId || !this.projectConfig || !this.projectDir) {
      logger.log(i18n(`${i18nKey}.failedToInitialize`));
      process.exit(EXIT_CODES.ERROR);
    }
  }

  async start() {
    this.spinnies = SpinniesManager.init();

    this.watcher = chokidar.watch(this.projectSourceDir, {
      ignoreInitial: true,
      ignored: file => shouldIgnoreFile(file),
    });

    this.uploadQueue = new PQueue({ concurrency: 10 });

    if (this.debug) {
      this.uploadQueue.on('error', error => {
        logger.debug(error);
      });
    }

    console.clear();
    this.spinnies.removeAll();
    this.updateConsoleHeader();

    this.uploadQueue.start();

    await this.startServers();

    await this.startWatching();
    this.updateKeypressListeners();

    // Do this again to pick up latest watch + server states
    this.updateConsoleHeader();
  }

  async stop() {
    this.clearConsoleContent();

    this.spinnies.add('cleanupMessage', {
      text: i18n(`${i18nKey}.exitingStart`),
    });

    await this.stopWatching();
    await this.cleanupServers();

    let exitCode = EXIT_CODES.SUCCESS;

    if (this.currentStagedBuildId) {
      try {
        await cancelStagedBuild(this.targetAccountId, this.projectConfig.name);
      } catch (err) {
        if (
          !isSpecifiedError(err, {
            subCategory: ERROR_TYPES.BUILD_NOT_IN_PROGRESS,
          })
        ) {
          logApiErrorInstance(
            err,
            new ApiErrorContext({
              accountId: this.targetAccountId,
              projectName: this.projectConfig.name,
            })
          );
          exitCode = EXIT_CODES.ERROR;
        }
      }
    }

    if (exitCode === EXIT_CODES.SUCCESS) {
      this.spinnies.succeed('cleanupMessage', {
        text: i18n(`${i18nKey}.exitingSucceed`),
      });
    } else {
      this.spinnies.fail('cleanupMessage', {
        text: i18n(`${i18nKey}.exitingFail`),
      });
    }

    process.exit(exitCode);
  }

  updateConsoleHeader() {
    this.spinnies.addOrUpdate('betaMessage', {
      text: i18n(`${i18nKey}.header.betaMessage`),
      category: 'header',
      status: 'non-spinnable',
    });

    // this.spinnies.addOrUpdate('learnMoreLink', {
    //   text: uiLink(
    //     i18n(`${i18nKey}.header.learnMoreLink`),
    //     this.generateLocalURL(`/hs/learnMore`),
    //     { inSpinnies: true }
    //   ),
    //   category: 'header',
    //   status: 'non-spinnable',
    // });
    this.spinnies.addOrUpdate('spacer-1', {
      text: ' ',
      status: 'non-spinnable',
      category: 'header',
    });
    this.spinnies.addOrUpdate('devModeRunning', {
      text: i18n(`${i18nKey}.header.running`, {
        accountIdentifier: uiAccountDescription(this.targetAccountId),
        projectName: this.projectConfig.name,
      }),
      isParent: true,
      category: 'header',
    });
    this.spinnies.addOrUpdate('devModeStatus', {
      text: i18n(`${i18nKey}.header.status.clean`),
      status: 'non-spinnable',
      indent: 1,
      category: 'header',
    });

    const viewText = DevServerManager.initialized
      ? uiLink(
          i18n(`${i18nKey}.header.viewInHubSpotLink`),
          DevServerManager.generateURL(`hs/project`),
          {
            inSpinnies: true,
          }
        )
      : ' ';

    this.spinnies.addOrUpdate('viewInHubSpotLink', {
      text: viewText,
      status: 'non-spinnable',
      indent: 1,
      category: 'header',
    });
    this.spinnies.addOrUpdate('spacer-2', {
      text: ' ',
      status: 'non-spinnable',
      category: 'header',
    });
    this.spinnies.addOrUpdate('quitHelper', {
      text: i18n(`${i18nKey}.header.quitHelper`),
      status: 'non-spinnable',
      indent: 1,
      category: 'header',
    });
    this.spinnies.addOrUpdate('lineSeparator', {
      text: '-'.repeat(50),
      status: 'non-spinnable',
      noIndent: true,
      category: 'header',
    });
  }

  clearConsoleContent() {
    this.spinnies.removeAll({ preserveCategory: 'header' });
  }

  updateKeypressListeners() {
    handleKeypress(async key => {
      if ((key.ctrl && key.name === 'c') || key.name === 'q') {
        this.stop();
      } else if (
        (key.name === 'y' || key.name === 'n') &&
        this.uploadPermission === UPLOAD_PERMISSIONS.manual &&
        this.hasAnyUnsupportedStandbyChanges()
      ) {
        this.spinnies.remove('manualUploadRequired');
        this.spinnies.remove('manualUploadExplanation1');
        this.spinnies.remove('manualUploadExplanation2');
        this.spinnies.remove('manualUploadPrompt');

        if (key.name === 'y') {
          this.spinnies.add(null, {
            text: i18n(`${i18nKey}.content.manualUploadConfirmed`),
            status: 'succeed',
            succeedColor: 'white',
            noIndent: true,
          });
          this.updateDevModeStatus('manualUpload');
          await this.createNewStagingBuild();
          await this.flushStandbyChanges();
          await this.queueBuild();
        } else if (key.name === 'n') {
          this.spinnies.add(null, {
            text: i18n(`${i18nKey}.content.manualUploadSkipped`),
            status: 'fail',
            failColor: 'white',
            noIndent: true,
          });
        }
      }
    });
  }

  updateDevModeStatus(langKey) {
    this.spinnies.update('devModeStatus', {
      text: i18n(`${i18nKey}.header.status.${langKey}`),
      status: 'non-spinnable',
      noIndent: true,
    });
  }

  async pauseUploadQueue() {
    this.uploadQueue.pause();
    await this.uploadQueue.onIdle();
  }

  hasAnyUnsupportedStandbyChanges() {
    return this.standbyChanges.some(({ supported }) => !supported);
  }

  async createNewStagingBuild() {
    try {
      const { buildId } = await provisionBuild(
        this.targetAccountId,
        this.projectConfig.name
      );
      this.currentStagedBuildId = buildId;
    } catch (err) {
      logger.debug(err);
      if (isSpecifiedError(err, { subCategory: ERROR_TYPES.PROJECT_LOCKED })) {
        await cancelStagedBuild(this.targetAccountId, this.projectConfig.name);
        logger.log(i18n(`${i18nKey}.previousStagingBuildCancelled`));
      }
      process.exit(EXIT_CODES.ERROR);
    }
  }

  async startWatching() {
    if (this.uploadPermission === UPLOAD_PERMISSIONS.always) {
      await this.createNewStagingBuild();
    }

    this.watcher.on('add', async filePath => {
      this.handleWatchEvent(filePath, WATCH_EVENTS.add);
    });
    this.watcher.on('change', async filePath => {
      this.handleWatchEvent(filePath, WATCH_EVENTS.change);
    });
    this.watcher.on('unlink', async filePath => {
      this.handleWatchEvent(filePath, WATCH_EVENTS.unlink);
    });
    this.watcher.on('unlinkDir', async filePath => {
      this.handleWatchEvent(filePath, WATCH_EVENTS.unlinkDir);
    });
  }

  async handleWatchEvent(filePath, event) {
    const changeInfo = {
      event,
      filePath,
      remotePath: path.relative(this.projectSourceDir, filePath),
    };

    if (changeInfo.filePath.includes('dist')) {
      return;
    }

    const notifyResponse = await this.notifyServers(changeInfo);

    if (!notifyResponse.uploadRequired) {
      this.updateDevModeStatus('supportedChange');
      this.addChangeToStandbyQueue({ ...changeInfo, supported: true });

      await this.executeServers(changeInfo, notifyResponse);
      return;
    }

    if (this.uploadPermission !== UPLOAD_PERMISSIONS.always) {
      this.handlePreventedUpload(changeInfo);
      return;
    }

    if (this.uploadQueue.isPaused) {
      if (
        !this.standbyChanges.find(
          changeInfo => changeInfo.filePath === filePath
        )
      ) {
        this.addChangeToStandbyQueue({ ...changeInfo, supported: false });
      }
    } else {
      await this.flushStandbyChanges();

      if (!this.uploadQueue.isPaused) {
        this.debounceQueueBuild();
      }

      return this.uploadQueue.add(async () => {
        await this.sendChanges(changeInfo);
      });
    }
  }

  handlePreventedUpload(changeInfo) {
    const { remotePath } = changeInfo;

    if (this.uploadPermission === UPLOAD_PERMISSIONS.never) {
      this.updateDevModeStatus('noUploadsAllowed');

      this.spinnies.add('noUploadsAllowed', {
        text: i18n(`${i18nKey}.content.noUploadsAllowed`, {
          filePath: remotePath,
        }),
        status: 'fail',
        failColor: 'white',
        noIndent: true,
      });
    } else {
      this.updateDevModeStatus('manualUploadRequired');

      if (
        !this.standbyChanges.find(
          standbyChangeInfo =>
            standbyChangeInfo.filePath === changeInfo.filePath
        )
      ) {
        this.addChangeToStandbyQueue({ ...changeInfo, supported: false });
      }

      this.spinnies.add('manualUploadRequired', {
        text: i18n(`${i18nKey}.content.manualUploadRequired`),
        status: 'fail',
        failColor: 'white',
        noIndent: true,
      });
      this.spinnies.add('manualUploadExplanation1', {
        text: i18n(`${i18nKey}.content.manualUploadExplanation1`),
        status: 'non-spinnable',
        indent: 1,
      });
      this.spinnies.add('manualUploadExplanation2', {
        text: i18n(`${i18nKey}.content.manualUploadExplanation2`),
        status: 'non-spinnable',
        indent: 1,
      });
      this.spinnies.add('manualUploadPrompt', {
        text: i18n(`${i18nKey}.content.manualUploadPrompt`),
        status: 'non-spinnable',
        indent: 1,
      });
    }
  }

  addChangeToStandbyQueue(changeInfo) {
    const { event, filePath } = changeInfo;

    if (event === WATCH_EVENTS.add || event === WATCH_EVENTS.change) {
      if (!isAllowedExtension(filePath, ['jsx'])) {
        logger.debug(`Extension not allowed: ${filePath}`);
        return;
      }
    }
    if (shouldIgnoreFile(filePath, true)) {
      logger.debug(`File ignored: ${filePath}`);
      return;
    }

    this.standbyChanges.push(changeInfo);
  }

  async sendChanges(changeInfo) {
    const { event, filePath, remotePath } = changeInfo;

    const spinniesKey = this.spinnies.add(null, {
      text: i18n(`${i18nKey}.content.uploadingChange`, {
        filePath: remotePath,
      }),
      status: 'non-spinnable',
    });

    try {
      if (event === WATCH_EVENTS.add || event === WATCH_EVENTS.change) {
        await uploadFileToBuild(
          this.targetAccountId,
          this.projectConfig.name,
          filePath,
          remotePath
        );
      } else if (
        event === WATCH_EVENTS.unlink ||
        event === WATCH_EVENTS.unlinkDir
      ) {
        await deleteFileFromBuild(
          this.targetAccountId,
          this.projectConfig.name,
          remotePath
        );
      }
    } catch (err) {
      logger.debug(err);
    }

    this.spinnies.update(spinniesKey, {
      text: i18n(`${i18nKey}.upload.uploadedChange`, {
        filePath: remotePath,
      }),
      status: 'non-spinnable',
    });
  }

  debounceQueueBuild() {
    if (this.uploadPermission === UPLOAD_PERMISSIONS.always) {
      this.updateDevModeStatus('uploadPending');
    }

    if (this.debouncedBuild) {
      clearTimeout(this.debouncedBuild);
    }

    this.debouncedBuild = setTimeout(
      this.queueBuild.bind(this),
      BUILD_DEBOUNCE_TIME
    );
  }

  async queueBuild() {
    const spinniesKey = this.spinnies.add(null, {
      text: i18n(`${i18nKey}.content.uploadingChanges`, {
        accountIdentifier: uiAccountDescription(this.targetAccountId),
      }),
      noIndent: true,
    });

    await this.pauseUploadQueue();

    try {
      await queueBuild(this.targetAccountId, this.projectConfig.name);
    } catch (err) {
      logger.debug(err);
      if (
        isSpecifiedError(err, {
          subCategory: ERROR_TYPES.MISSING_PROJECT_PROVISION,
        })
      ) {
        logger.log(i18n(`${i18nKey}.cancelledFromUI`));
        this.stop();
      } else {
        logApiErrorInstance(
          err,
          new ApiErrorContext({
            accountId: this.targetAccountId,
            projectName: this.projectConfig.name,
          })
        );
      }
      return;
    }

    await pollProjectBuildAndDeploy(
      this.targetAccountId,
      this.projectConfig,
      null,
      this.currentStagedBuildId,
      true
    );

    this.spinnies.succeed(spinniesKey, {
      text: i18n(`${i18nKey}.content.uploadedChanges`, {
        accountIdentifier: uiAccountDescription(this.targetAccountId),
      }),
      succeedColor: 'white',
      noIndent: true,
    });

    this.spinnies.removeAll({ targetCategory: 'projectPollStatus' });

    if (this.uploadPermission === UPLOAD_PERMISSIONS.always) {
      await this.createNewStagingBuild();
    }

    this.uploadQueue.start();

    if (this.hasAnyUnsupportedStandbyChanges()) {
      this.flushStandbyChanges();
    } else {
      this.updateDevModeStatus('clean');
    }
  }

  async flushStandbyChanges() {
    if (this.standbyChanges.length) {
      await this.uploadQueue.addAll(
        this.standbyChanges.map(changeInfo => {
          return async () => {
            if (
              this.uploadPermission === UPLOAD_PERMISSIONS.always &&
              !this.uploadQueue.isPaused
            ) {
              this.debounceQueueBuild();
            }
            await this.sendChanges(changeInfo);
          };
        })
      );
      this.standbyChanges = [];
    }
  }

  async stopWatching() {
    await this.watcher.close();
  }

  handleServerLog(serverKey, ...args) {
    this.spinnies.add(null, {
      text: `${args.join('')}`,
      status: 'non-spinnable',
    });
  }

  async startServers() {
    try {
      await DevServerManager.start({
        accountId: this.targetAccountId,
        debug: this.debug,
        logger: this.handleServerLog.bind(this),
        port: this.port,
        projectConfig: this.projectConfig,
        projectSourceDir: this.projectSourceDir,
      });
    } catch (e) {
      if (this.debug) {
        logger.error(e);
      }
      this.spinnies.add('devServerStartError', {
        text: i18n(`${i18nKey}.content.devServerStartError`),
        status: 'non-spinnable',
      });
    }
  }

  async notifyServers(changeInfo) {
    let notifyResponse = { uploadRequired: true };

    try {
      notifyResponse = await DevServerManager.notify(changeInfo);
    } catch (e) {
      if (this.debug) {
        logger.error(e);
      }
      this.spinnies.add('devServerNotifyError', {
        text: i18n(`${i18nKey}.content.devServerNotifyError`),
        status: 'non-spinnable',
      });
    }

    return notifyResponse;
  }

  async executeServers(changeInfo, notifyResponse) {
    try {
      await DevServerManager.execute(changeInfo, notifyResponse);
    } catch (e) {
      if (this.debug) {
        logger.error(e);
      }
      this.spinnies.add('devServerExecuteError', {
        text: i18n(`${i18nKey}.content.devServerExecuteError`),
        status: 'non-spinnable',
      });
    }
  }

  async cleanupServers() {
    try {
      await DevServerManager.cleanup();
    } catch (e) {
      if (this.debug) {
        logger.error(e);
      }
      this.spinnies.add('devServerCleanupError', {
        text: i18n(`${i18nKey}.content.devServerCleanupError`),
        status: 'non-spinnable',
      });
    }
  }
}

module.exports = { LocalDevManager, UPLOAD_PERMISSIONS };
