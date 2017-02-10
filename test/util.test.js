import { format } from '../src/util';

test('format applies substitutions', () => {
  expect(format({ text: 'Hi {0}, formatting is working {1}' }, ['Rob', 'OK'])).toBe('Hi Rob, formatting is working OK');
});
