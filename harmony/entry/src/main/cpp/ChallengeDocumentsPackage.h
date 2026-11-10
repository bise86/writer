#pragma once
#include "RNOH/ArkTSTurboModule.h"
#include "RNOH/Package.h"

namespace rnoh {
class JSI_EXPORT ChallengeDocumentsTurboModule : public ArkTSTurboModule {
 public:
  ChallengeDocumentsTurboModule(const ArkTSTurboModule::Context ctx, const std::string name)
      : ArkTSTurboModule(ctx, name) {
    methodMap_ = {
        ARK_ASYNC_METHOD_METADATA(pickPdf, 0),
        ARK_ASYNC_METHOD_METADATA(renderPdf, 1),
        ARK_ASYNC_METHOD_METADATA(savePdf, 2),
    };
  }
};

class ChallengeDocumentsFactoryDelegate : public TurboModuleFactoryDelegate {
 public:
  SharedTurboModule createTurboModule(Context ctx, const std::string& name) const override {
    if (name == "ChallengeDocuments") {
      return std::make_shared<ChallengeDocumentsTurboModule>(ctx, name);
    }
    return nullptr;
  }
};

class ChallengeDocumentsPackage : public Package {
 public:
  explicit ChallengeDocumentsPackage(Package::Context ctx) : Package(ctx) {}
  std::unique_ptr<TurboModuleFactoryDelegate> createTurboModuleFactoryDelegate() override {
    return std::make_unique<ChallengeDocumentsFactoryDelegate>();
  }
};
} // namespace rnoh
