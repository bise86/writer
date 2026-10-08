import {
  AnyJSBundleProvider,
  MetroJSBundleProvider,
  RNApp,
  RNOHErrorDialog,
  ResourceJSBundleProvider,
  RNOHCoreContext,
  ComponentBuilderContext
} from '@rnoh/react-native-openharmony';
import { getRNOHPackages } from '../PackageProvider';
import { RTNPdfView, PDF_VIEW_TYPE } from '@react-native-oh-tpl/react-native-pdf';

@Builder
function buildEssayComponent(ctx: ComponentBuilderContext) {
  if (ctx.componentName === PDF_VIEW_TYPE) {
    RTNPdfView({ ctx: ctx.rnComponentContext, tag: ctx.tag })
  }
}


@Entry
@Component
struct Index {
  @StorageLink('RNOHCoreContext') private rnohCoreContext: RNOHCoreContext | undefined = undefined

  build() {
    Column() {
      if (this.rnohCoreContext) {
        if (this.rnohCoreContext?.isDebugModeEnabled) {
          RNOHErrorDialog({ ctx: this.rnohCoreContext })
        }
        RNApp({
          rnInstanceConfig: {
            name: "EssayLens",
            createRNPackages: getRNOHPackages,
            fontResourceByFontFamily: {},
            arkTsComponentNames: [PDF_VIEW_TYPE],
            enableDebugger: this.rnohCoreContext?.isDebugModeEnabled,
          },
          wrappedCustomRNComponentBuilder: wrapBuilder(buildEssayComponent),
          appKey: "EssayLens",
          jsBundleProvider: this.rnohCoreContext?.isDebugModeEnabled ?
            new AnyJSBundleProvider([
              new MetroJSBundleProvider(),
              new ResourceJSBundleProvider(this.rnohCoreContext.uiAbilityContext.resourceManager, 'hermes_bundle.hbc'),
            ]) :
            /**
             * NOTE: The HBC format is recommended for Hermes in a production environment. HBC provides better performance and loading times.
             */
            new ResourceJSBundleProvider(this.rnohCoreContext.uiAbilityContext.resourceManager, 'hermes_bundle.hbc'),
        })
      }
    }
    .height('100%')
    .width('100%')
  }
}
