import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  animalProblems,
  animalToForm,
  correctionBody,
  correctionProblems,
  emptyAnimal,
  emptyLitterAnimal,
  litterBody,
  litterProblems,
  ownerOn,
  registerAnimalBody,
  transferProblems,
} from '../src/animal-logic.ts';

const today = '2026-11-19';

test('a new animal needs species, sex, name, birth date and an owner; a chip is 15 digits', () => {
  assert.deepEqual(animalProblems(emptyAnimal(today), today), ['animal.needSpecies', 'animal.needSex', 'animal.needName', 'animal.needBirthDate', 'animal.needOwner']);
  const f = { ...emptyAnimal(today, 'pty_owner001'), species: 'dog', sex: 'female', name: ' Bella ', birthDate: '2019-04-01', microchip: '752 098 100 123 456' };
  assert.deepEqual(animalProblems(f, today), []);
  assert.deepEqual(animalProblems({ ...f, microchip: '1234', birthDate: '2027-01-01' }, today), ['animal.futureBirth', 'animal.badChip']);
  assert.deepEqual(registerAnimalBody(f), {
    market: 'SE',
    species: 'dog',
    sex: 'female',
    neutered: false,
    name: 'Bella',
    birthDate: '2019-04-01',
    allowLookup: false,
    identifiers: [{ type: 'microchip', value: '752098100123456' }],
    owner: { partyId: 'pty_owner001', from: today },
  });
});

test('a correction needs a reason, and a date of death between birth and today', () => {
  const f = animalToForm({ market: 'SE', species: 'dog', breed: 'labrador', sex: 'female', neutered: false, name: 'Bella', birthDate: '2019-04-01', allowLookup: true });
  assert.deepEqual(correctionProblems(f, ' ', today), ['settings.needReason']);
  assert.deepEqual(correctionProblems({ ...f, deceasedOn: '2027-01-01' }, 'Died', today), ['animal.badDeath']);
  assert.deepEqual(correctionBody({ ...f, neutered: true }, 4, ' Neutered '), {
    basedOnRevision: 4,
    reason: 'Neutered',
    breed: 'labrador',
    sex: 'female',
    neutered: true,
    name: 'Bella',
    birthDate: '2019-04-01',
    allowLookup: true,
  });
});

test('the owner on a date, and what a change of owner needs', () => {
  const owners = [
    { partyId: 'pty_a', validFrom: '2019-05-01', validTo: '2024-01-01' },
    { partyId: 'pty_b', validFrom: '2024-01-01' },
  ];
  assert.equal(ownerOn(owners, '2023-12-31')?.partyId, 'pty_a');
  assert.equal(ownerOn(owners, today)?.partyId, 'pty_b');
  const current = ownerOn(owners, today);
  assert.deepEqual(transferProblems({ partyId: 'pty_b', from: today }, current), ['animal.sameOwner']);
  assert.deepEqual(transferProblems({ partyId: 'pty_c', from: '2023-06-01' }, current), ['animal.transferBefore']);
  assert.deepEqual(transferProblems({ partyId: 'pty_c', from: today }, current), []);
});

test('a litter: a breeder, 1–24 animals with name and sex, and parents as animal ids', () => {
  const f = { market: 'SE', species: 'dog', birthDate: '2026-10-01', damId: 'ani_bella', sireId: 'Rex', breederPartyId: 'pty_owner001', animals: [emptyLitterAnimal()] };
  assert.deepEqual(litterProblems(f, today), ['animal.badParent', 'animal.litterAnimal']);
  const ok = { ...f, sireId: '', animals: [{ name: 'Valp 1', sex: 'male', breed: '', microchip: '' }] };
  assert.deepEqual(litterProblems(ok, today), []);
  assert.deepEqual(litterBody(ok), { market: 'SE', species: 'dog', birthDate: '2026-10-01', damId: 'ani_bella', breederPartyId: 'pty_owner001', animals: [{ name: 'Valp 1', sex: 'male' }] });
});
