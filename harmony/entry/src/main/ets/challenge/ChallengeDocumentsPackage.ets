import { RNOHPackage } from '@rnoh/react-native-openharmony';
import { TurboModulesFactory } from '@rnoh/react-native-openharmony/ts';
import type { TurboModule, TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { ChallengeDocumentsModule } from './ChallengeDocumentsModule';

class ChallengeDocumentsFactory extends TurboModulesFactory {
  createTurboModule(name: string): TurboModule | null {
    return name === 'ChallengeDocuments' ? new ChallengeDocumentsModule(this.ctx) : null;
  }

  hasTurboModule(name: string): boolean {
    return name === 'ChallengeDocuments';
  }
}

export class ChallengeDocumentsPackage extends RNOHPackage {
  createTurboModulesFactory(ctx: TurboModuleContext): TurboModulesFactory {
    return new ChallengeDocumentsFactory(ctx);
  }
}
