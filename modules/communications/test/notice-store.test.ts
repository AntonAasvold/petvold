import { InMemoryNoticeStore } from '../src/index.ts';
import { noticeStoreSuite } from '../test-suites/notice-store.ts';

noticeStoreSuite('InMemoryNoticeStore', async () => ({ store: new InMemoryNoticeStore() }));
