import { InMemoryAnimalStore } from '../src/index.ts';
import { animalStoreSuite } from '../test-suites/animal-store.ts';

animalStoreSuite('InMemoryAnimalStore', async () => ({ store: new InMemoryAnimalStore() }));
