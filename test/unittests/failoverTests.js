/*
 * Copyright 2019. F5 Networks, Inc. See End User License Agreement ("EULA") for
 * license terms. Notwithstanding anything to the contrary in the EULA, Licensee
 * may copy and modify this software product for its internal business purposes.
 * Further, Licensee may upload, publish and distribute the modified version of
 * the software product on devcentral.f5.com.
 */

'use strict';

const assert = require('assert');
const sinon = require('sinon'); // eslint-disable-line import/no-extraneous-dependencies
const constants = require('../constants.js');

const declaration = constants.declarations.basic;

/* eslint-disable global-require */

describe('Failover', () => {
    let config;
    let Device;
    let CloudFactory;
    let FailoverClient;
    let failover;

    let deviceGlobalSettingsMock;
    let deviceGetTrafficGroupsMock;
    let deviceGetSelfAddressesMock;
    let deviceGetVirtualAddressesMock;
    let deviceGetNatAddressesMock;
    let deviceGetSnatTranslationAddressesMock;
    let cloudProviderMock;
    let downloadDataFromStorageMock;

    let spyOnUpdateAddresses;
    let spyOnUpdateRoutes;
    let uploadDataToStorageSpy;
    let setConfigSpy;

    const globalSettingsMockResponse = {
        entries: {
            key01: {
                nestedStats: {
                    entries: {
                        deviceName: { description: 'some_hostname' },
                        failoverState: { description: 'active' },
                        trafficGroup: { description: 'traffic-group-1' }
                    }
                }
            }
        }
    };

    beforeEach(() => {
        config = require('../../src/nodejs/config.js');
        Device = require('../../src/nodejs/device.js');
        CloudFactory = require('../../src/nodejs/providers/cloudFactory.js');
        FailoverClient = require('../../src/nodejs/failover.js').FailoverClient;

        sinon.stub(Device.prototype, 'init').resolves();
        sinon.stub(Device.prototype, 'executeBigIpBashCmd').resolves('');
        sinon.stub(Device.prototype, 'getDataGroups').resolves(constants.DATA_GROUP_OBJECT);
        sinon.stub(Device.prototype, 'createDataGroup').resolves(constants.DATA_GROUP_OBJECT);
        deviceGlobalSettingsMock = sinon.stub(Device.prototype, 'getGlobalSettings');
        deviceGetTrafficGroupsMock = sinon.stub(Device.prototype, 'getTrafficGroupsStats');
        deviceGetSelfAddressesMock = sinon.stub(Device.prototype, 'getSelfAddresses');
        deviceGetVirtualAddressesMock = sinon.stub(Device.prototype, 'getVirtualAddresses');
        deviceGetSnatTranslationAddressesMock = sinon.stub(Device.prototype, 'getSnatTranslationAddresses');
        deviceGetNatAddressesMock = sinon.stub(Device.prototype, 'getNatAddresses');

        cloudProviderMock = {
            init: () => Promise.resolve({}),
            updateAddresses: () => Promise.resolve({}),
            updateRoutes: () => Promise.resolve({}),
            downloadDataFromStorage: () => Promise.resolve({}),
            uploadDataToStorage: () => Promise.resolve({}),
            getAssociatedAddressAndRouteInfo: () => Promise.resolve({ routes: [], addresses: [] })
        };
        downloadDataFromStorageMock = sinon.stub(cloudProviderMock, 'downloadDataFromStorage');
        downloadDataFromStorageMock.onCall(0).resolves({ taskState: constants.FAILOVER_STATES.PASS });
        spyOnUpdateAddresses = sinon.spy(cloudProviderMock, 'updateAddresses');
        spyOnUpdateRoutes = sinon.spy(cloudProviderMock, 'updateRoutes');
        sinon.stub(CloudFactory, 'getCloudProvider').returns(cloudProviderMock);

        deviceGlobalSettingsMock.returns({ hostname: 'some_hostname' });
        deviceGetTrafficGroupsMock.returns(globalSettingsMockResponse);

        deviceGetSelfAddressesMock.returns([
            {
                name: 'traffic-group-1',
                address: '1.1.1.1',
                trafficGroup: 'local_only'
            }
        ]);
        deviceGetVirtualAddressesMock.returns([
            {
                address: '2.2.2.2',
                trafficGroup: 'traffic-group-1',
                partition: 'Common'
            }
        ]);
        deviceGetSnatTranslationAddressesMock.returns([]);
        deviceGetNatAddressesMock.returns([]);

        uploadDataToStorageSpy = sinon.stub(cloudProviderMock, 'uploadDataToStorage').resolves({});

        failover = new FailoverClient();
    });
    afterEach(() => {
        sinon.restore();
    });
    after(() => {
        Object.keys(require.cache).forEach((key) => {
            delete require.cache[key];
        });
    });

    /**
     * Local failover validation function
     *
     * @param {Object}  options                     - function options
     * @param {Integer} [options.localAddresses]    - local addresses to validate against
     * @param {Integer} [options.failoverAddresses] - failover addresses to validate against
     *
     * @returns {Void}
     */
    function validateFailover(options) {
        // process function options
        options = options || {};
        const localAddresses = options.localAddresses || ['1.1.1.1'];
        const failoverAddresses = options.failoverAddresses || ['2.2.2.2'];
        // the updateAddresses function will only be invoked if there are traffic groups in the hostname
        // verify that cloudProvider.updateAddresses method gets called - discover
        const updateAddressesDiscoverCall = spyOnUpdateAddresses.getCall(0).args[0];
        assert.deepStrictEqual(updateAddressesDiscoverCall.localAddresses, localAddresses);
        assert.deepStrictEqual(updateAddressesDiscoverCall.failoverAddresses, failoverAddresses);
        assert.strictEqual(updateAddressesDiscoverCall.discoverOnly, true);

        // verify that cloudProvider.updateRoutes method gets called - discover
        const updateRoutesDiscoverCall = spyOnUpdateRoutes.getCall(0).args[0];
        assert.deepStrictEqual(updateRoutesDiscoverCall.localAddresses, localAddresses);
        assert.strictEqual(updateRoutesDiscoverCall.discoverOnly, true);

        // verify that cloudProvider.updateAddresses method gets called - update
        const updateAddressesUpdateCall = spyOnUpdateAddresses.getCall(1).args[0];
        assert.deepStrictEqual(updateAddressesUpdateCall.updateOperations, {});

        // verify that cloudProvider.updateRoutes method gets called - update
        const updateRoutesUpdateCall = spyOnUpdateRoutes.getCall(1).args[0];
        assert.deepStrictEqual(updateRoutesUpdateCall.updateOperations, {});
    }

    it('should execute failover', () => config.init()
        .then(() => config.processConfigRequest(declaration))
        .then(() => failover.init())
        .then(() => failover.execute())
        .then(() => {
            validateFailover();
        })
        .catch(err => Promise.reject(err)));

    it('should execute failover with retry', () => {
        // ensure RUN then PASS results in successful failover operation
        downloadDataFromStorageMock.onCall(0).resolves({ taskState: constants.FAILOVER_STATES.RUN });
        downloadDataFromStorageMock.onCall(1).resolves({ taskState: constants.FAILOVER_STATES.PASS });

        return config.init()
            .then(() => config.processConfigRequest(declaration))
            .then(() => failover.init())
            .then(() => failover.execute())
            .then(() => {
                validateFailover();
            })
            .catch(err => Promise.reject(err));
    });

    it('should execute failover with virtual and snat addresses', () => {
        deviceGetSnatTranslationAddressesMock.returns([
            {
                address: '2.2.2.3',
                trafficGroup: 'traffic-group-1',
                partition: 'Common'
            }
        ]);

        return config.init()
            .then(() => config.processConfigRequest(declaration))
            .then(() => failover.init())
            .then(() => failover.execute())
            .then(() => {
                validateFailover({ failoverAddresses: ['2.2.2.2', '2.2.2.3'] });
            })
            .catch(err => Promise.reject(err));
    });

    it('should execute failover with virtual, snat and nat addresses', () => {
        deviceGetSnatTranslationAddressesMock.returns([
            {
                address: '2.2.2.3',
                trafficGroup: 'traffic-group-1',
                partition: 'Common'
            }
        ]);
        deviceGetNatAddressesMock.returns([
            {
                originatingAddress: '1.1.1.4',
                translationAddress: '2.2.2.4',
                trafficGroup: 'traffic-group-1',
                partition: 'Common'
            }
        ]);

        return config.init()
            .then(() => config.processConfigRequest(declaration))
            .then(() => failover.init())
            .then(() => failover.execute())
            .then(() => {
                validateFailover({ failoverAddresses: ['2.2.2.2', '2.2.2.3', '2.2.2.4'] });
            })
            .catch(err => Promise.reject(err));
    });

    it('should result in no failover addresses when no virtual addresses exist', () => {
        deviceGetVirtualAddressesMock.returns([]);

        return config.init()
            .then(() => config.processConfigRequest(declaration))
            .then(() => failover.init())
            .then(() => failover.execute())
            .then(() => {
                validateFailover({ failoverAddresses: [] });
            });
    });

    it('should result in no failover addresses when the device has no matching traffic groups', () => {
        deviceGetTrafficGroupsMock.returns({
            entries: {
                key01: {
                    nestedStats: {
                        entries: {
                            deviceName: { description: 'some_hostname' },
                            failoverState: { description: 'active' },
                            trafficGroup: { description: 'some-other-traffic-group' }
                        }
                    }
                }
            }
        });

        return config.init()
            .then(() => config.processConfigRequest(declaration))
            .then(() => failover.init())
            .then(() => failover.execute())
            .then(() => {
                validateFailover({ failoverAddresses: [] });
            });
    });

    it('should result in no failover addresses when device hostname does not match any traffic groups', () => {
        deviceGlobalSettingsMock.returns({ hostname: 'some_other_hostname' });

        return config.init()
            .then(() => config.processConfigRequest(declaration))
            .then(() => failover.init())
            .then(() => failover.execute())
            .catch(err => Promise.reject(err));
    });

    it('should recover from a previous failover failure', () => {
        downloadDataFromStorageMock.onCall(0).resolves({
            taskState: constants.FAILOVER_STATES.FAIL,
            failoverOperations: {
                addresses: {
                    operation: 'addresses'
                },
                routes: {
                    operation: 'routes'
                }
            },
            message: 'Failover failed because of x'
        });
        setConfigSpy = sinon.stub(Object.getPrototypeOf(config), 'setConfig').resolves();

        return config.init()
            .then(() => config.processConfigRequest(declaration))
            .then(() => failover.init())
            .then(() => failover.execute())
            .then(() => {
                // verify that the uploaded task state is running and then eventually succeeded
                assert.strictEqual(uploadDataToStorageSpy.getCall(0).args[1].taskState, constants.FAILOVER_STATES.RUN);
                assert.strictEqual(uploadDataToStorageSpy.lastCall.args[1].taskState, constants.FAILOVER_STATES.PASS);
                assert.strictEqual(setConfigSpy.getCall(0).lastArg.environment, 'azure');
                assert.strictEqual(uploadDataToStorageSpy.lastCall.lastArg.message, 'Failover Completed Successfully');
            })
            .catch(err => Promise.reject(err));
    });

    it('should failover virtual addresses in non Common partitions', () => {
        deviceGetVirtualAddressesMock.returns([
            {
                address: '2.2.2.2',
                trafficGroup: 'traffic-group-1',
                parition: 'Common'
            },
            {
                address: '3.3.3.3',
                trafficGroup: 'traffic-group-1',
                parition: 'Tenant_01'
            }
        ]);

        return config.init()
            .then(() => config.processConfigRequest(declaration))
            .then(() => failover.init())
            .then(() => failover.execute())
            .then(() => {
                validateFailover({ failoverAddresses: ['2.2.2.2', '3.3.3.3'] });
            })
            .catch(err => Promise.reject(err));
    });

    it('should reject when an error occurs during failover execution', () => {
        deviceGlobalSettingsMock.returns();

        return config.init()
            .then(() => config.processConfigRequest(declaration))
            .then(() => failover.init())
            .then(() => failover.execute())
            .then(() => {
                assert.fail();
            })
            .catch(() => {
                // fails when error recieved
                assert.ok(true);
            });
    });

    it('should reject when enviroment is not provided during failover execution', () => {
        sinon.stub(Object.getPrototypeOf(config), 'getConfig').resolves({});

        return failover.init()
            .then(() => failover.execute())
            .then(() => {
                assert.fail();
            })
            .catch(() => {
                // fails when error recieved
                assert.ok(true);
            });
    });

    it('should reset state file when reset state file function is called after config declaration has occurred', () => config.init()
        .then(() => config.processConfigRequest(declaration))
        .then(() => failover.init())
        .then(() => failover.resetFailoverState({ resetStateFile: true }))
        .then(() => {
            assert.strictEqual(uploadDataToStorageSpy.lastCall.args[1].taskState, constants.FAILOVER_STATES.PASS);
            assert.strictEqual(uploadDataToStorageSpy.lastCall.args[1].message, constants.STATE_FILE_RESET_MESSAGE);
            assert.deepStrictEqual(uploadDataToStorageSpy.lastCall.args[1].failoverOperations, {});
        })
        .catch(err => Promise.reject(err)));

    it('should reset state file when reset state file function is called before declaration', () => failover.init()
        .then(() => failover.resetFailoverState({ resetStateFile: true }))
        .then(() => {
            assert.strictEqual(uploadDataToStorageSpy.lastCall.args[1].taskState, constants.FAILOVER_STATES.PASS);
            assert.strictEqual(uploadDataToStorageSpy.lastCall.args[1].message, constants.STATE_FILE_RESET_MESSAGE);
            assert.deepStrictEqual(uploadDataToStorageSpy.lastCall.args[1].failoverOperations, {});
        })
        .catch(err => Promise.reject(err)));

    it('should not reset state file when reset state file key is set to false', () => config.init()
        .then(() => config.processConfigRequest(declaration))
        .then(() => failover.init())
        .then(() => failover.resetFailoverState({ resetStateFile: false }))
        .then(() => {
            assert(uploadDataToStorageSpy.notCalled);
        })
        .catch(err => Promise.reject(err)));

    it('should retrieve the taskstate file', () => config.init()
        .then(() => config.processConfigRequest(declaration))
        .then(() => failover.init())
        .then(() => failover.getTaskStateFile())
        .then((result) => {
            assert(result);
        })
        .catch(err => Promise.reject(err)));

    it('should get current HA status and mapped cloud objects', () => config.init()
        .then(() => config.processConfigRequest(declaration))
        .then(() => failover.init())
        .then(() => failover.getFailoverStatusAndObjects())
        .then((data) => {
            assert.deepStrictEqual({
                routes: [],
                addresses: [],
                hostName: 'some_hostname',
                deviceStatus: 'active',
                trafficGroup: [
                    {
                        name: 'traffic-group-1'
                    }
                ]
            }, data);
        }));
});
