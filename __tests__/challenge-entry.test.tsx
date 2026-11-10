import React from 'react';
import {Pressable, Text} from 'react-native';
import {act, create, ReactTestRenderer} from 'react-test-renderer';
import App from '../App';
import ChallengeScreen from '../src/components/ChallengeScreen';
import {DEFAULT_SETTINGS} from '../src/settings';

jest.mock('../src/components/Startup', () => ({
  __esModule: true,
  default: ({children}: any) =>
    children({
      essays: [],
      settings: jest.requireActual('../src/settings').DEFAULT_SETTINGS,
    }),
}));
jest.mock('../src/components/ChallengeScreen', () => ({
  __esModule: true,
  default: 'ChallengeScreen',
}));
jest.mock('../src/components/ImageCropper', () => 'ImageCropper');
jest.mock('../src/components/EssayDetail', () => 'EssayDetail');
jest.mock('../src/components/Reports', () => 'Reports');
jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(),
  launchImageLibrary: jest.fn(),
}));
jest.mock('../src/db/database', () => ({
  listEssays: jest.fn(async () => []),
  saveSettings: jest.fn(),
}));
jest.mock('../src/services/images', () => ({
  cropImage: jest.fn(),
  persistImage: jest.fn(),
  discardPreparedImages: jest.fn(),
}));
jest.mock('../src/services/pipeline', () => ({
  runEssayPipeline: jest.fn(),
  retryEssay: jest.fn(),
}));

let view: ReactTestRenderer;
const press = (label: string) =>
  act(() => {
    view.root
      .findAllByType(Pressable)
      .find(node =>
        node.findAllByType(Text).some(child => child.props.children === label),
      )!
      .props.onPress();
  });
beforeEach(async () => {
  jest.clearAllMocks();
  await act(async () => {
    view = create(<App />);
  });
});
afterEach(() => act(() => view.unmount()));

test('挑战与作文批改、英文批改同级，独立导航不改变原写作入口', () => {
  const labels = view.root.findAllByType(Text).map(node => node.props.children);
  expect(labels).toEqual(
    expect.arrayContaining(['作文批改', '英文批改', '挑战']),
  );
  press('挑战');
  expect(view.root.findByType(ChallengeScreen).props.settings).toEqual(
    DEFAULT_SETTINGS,
  );
  act(() => view.root.findByType(ChallengeScreen).props.onBack());
  press('英文批改');
  expect(JSON.stringify(view.toJSON())).toContain('还没有英文作文');
  expect(view.root.findAllByType(ChallengeScreen)).toHaveLength(0);
});

test('挑战进入系统设置后返回原入口，并记住已经选中的挑战记录', () => {
  press('挑战');
  act(() =>
    view.root
      .findByType(ChallengeScreen)
      .props.onSelectionChange('challenge_saved'),
  );
  act(() => view.root.findByType(ChallengeScreen).props.onSettings());
  expect(JSON.stringify(view.toJSON())).toContain('系统设置');
  press('‹ 返回');
  expect(view.root.findByType(ChallengeScreen).props.initialChallengeId).toBe(
    'challenge_saved',
  );
  act(() => view.root.findByType(ChallengeScreen).props.onBack());
  press('作文批改');
  press('⚙');
  press('‹ 返回');
  expect(JSON.stringify(view.toJSON())).toContain('还没有作文');
  expect(view.root.findAllByType(ChallengeScreen)).toHaveLength(0);
});
