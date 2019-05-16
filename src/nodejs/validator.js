/**
 * Copyright 2018 F5 Networks, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const Ajv = require('ajv');

const baseSchema = require('./schema/base_schema.json');
const initializeSchema = require('./schema/initialize_schema.json');
const failoverSchema = require('./schema/failover_schema.json');
const controlsSchema = require('./schema/controls_schema.json');
const sharedSchema = require('./schema/shared_schema.json');

class Validator {
    constructor() {
        const ajv = new Ajv(
            {
                allErrors: false,
                useDefaults: true,
                coerceTypes: true,
                extendRefs: 'fail'
            }
        );

        this.validator = ajv
            .addSchema(baseSchema)
            .addSchema(initializeSchema)
            .addSchema(failoverSchema)
            .addSchema(controlsSchema)
            .compile(sharedSchema);
    }

    validate(data) {
        const isValid = this.validator(data);
        return {
            isValid,
            errors: this.validator.errors
        };
    }
}

module.exports = Validator;