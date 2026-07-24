#include "system_cursor_lease.h"

namespace cursor_host {

SystemCursorLease::SystemCursorLease(HANDLE hidden_event)
    : hidden_event_(hidden_event) {}

SystemCursorLease::~SystemCursorLease() { Release(); }

bool SystemCursorLease::Acquire() {
  if (active()) return true;
  int result = 0;
  do {
    result = ShowCursor(FALSE);
    ++adjustments_;
  } while (result >= 0 && adjustments_ < 32);
  if (result >= 0) {
    Release();
    return false;
  }
  SetEvent(hidden_event_);
  return true;
}

void SystemCursorLease::Release() {
  if (!active()) return;
  ResetEvent(hidden_event_);
  while (adjustments_ > 0) {
    ShowCursor(TRUE);
    --adjustments_;
  }
}

}  // namespace cursor_host
