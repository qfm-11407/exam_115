import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateClients} from '../scripts/simulate-clients.mjs';
test('30 isolated controllers recover 28 student uploads after busy responses, response loss and a Drive interruption',async()=>{const r=await simulateClients();assert.equal(r.clients,30);assert.equal(r.realGAS,false);assert.equal(r.submitted,28);assert.equal(r.files,28);assert.equal(r.duplicateFiles,0);assert.equal(r.allConfirmed,true);});
