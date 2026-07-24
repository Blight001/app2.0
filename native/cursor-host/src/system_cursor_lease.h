#pragma once

#include <windows.h>

namespace cursor_host {

class SystemCursorLease {
 public:
  explicit SystemCursorLease(HANDLE hidden_event);
  ~SystemCursorLease();
  bool Acquire();
  void Release();
  bool active() const { return adjustments_ > 0; }

 private:
  HANDLE hidden_event_;
  int adjustments_ = 0;
};

}  // namespace cursor_host
