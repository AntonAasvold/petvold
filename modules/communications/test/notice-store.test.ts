import { InMemoryNoticeSettingsStore, InMemoryNoticeStore } from '../src/index.ts';
import { noticeSettingsStoreSuite, noticeStoreSuite } from '../test-suites/notice-store.ts';

noticeStoreSuite('InMemoryNoticeStore', async () => ({ store: new InMemoryNoticeStore() }));
noticeSettingsStoreSuite('InMemoryNoticeSettingsStore', async () => ({ settings: new InMemoryNoticeSettingsStore() }));
