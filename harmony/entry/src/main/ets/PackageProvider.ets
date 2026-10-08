import type { RNPackageContext, RNOHPackage } from '@rnoh/react-native-openharmony';
import { createRNOHPackages as createRNOHPackagesAutolinking } from "./RNOHPackagesFactory"

import { RNSharePackage } from '@react-native-oh-tpl/react-native-share/ts';
import { BlobUtilPackage } from '@react-native-oh-tpl/react-native-blob-util/ts';

export function getRNOHPackages(ctx: RNPackageContext): RNOHPackage[] {
  return [
    ...createRNOHPackagesAutolinking(ctx),
    new RNSharePackage(ctx),
    new BlobUtilPackage(ctx)
  ]
}
