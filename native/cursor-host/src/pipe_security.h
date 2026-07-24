#pragma once

#include <windows.h>

namespace cursor_host {

class CurrentUserPipeSecurity {
 public:
  CurrentUserPipeSecurity();
  ~CurrentUserPipeSecurity();
  CurrentUserPipeSecurity(const CurrentUserPipeSecurity&) = delete;
  CurrentUserPipeSecurity& operator=(const CurrentUserPipeSecurity&) = delete;

  bool valid() const { return descriptor_ != nullptr; }
  SECURITY_ATTRIBUTES* attributes() { return &attributes_; }

 private:
  PSECURITY_DESCRIPTOR descriptor_ = nullptr;
  SECURITY_ATTRIBUTES attributes_{};
};

}  // namespace cursor_host
