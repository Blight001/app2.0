#include "pipe_security.h"

#include <sddl.h>

#include <string>
#include <vector>

namespace cursor_host {

CurrentUserPipeSecurity::CurrentUserPipeSecurity() {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return;
  DWORD bytes = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &bytes);
  std::vector<std::uint8_t> buffer(bytes);
  const bool read = GetTokenInformation(
      token, TokenUser, buffer.data(), bytes, &bytes) != FALSE;
  CloseHandle(token);
  if (!read) return;

  const auto* user = reinterpret_cast<const TOKEN_USER*>(buffer.data());
  LPWSTR sid = nullptr;
  if (!ConvertSidToStringSidW(user->User.Sid, &sid)) return;
  const std::wstring sddl =
      L"D:P(A;;GA;;;SY)(A;;GA;;;" + std::wstring(sid) + L")";
  LocalFree(sid);
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
          sddl.c_str(), SDDL_REVISION_1, &descriptor_, nullptr)) {
    descriptor_ = nullptr;
    return;
  }
  attributes_.nLength = sizeof(attributes_);
  attributes_.lpSecurityDescriptor = descriptor_;
  attributes_.bInheritHandle = FALSE;
}

CurrentUserPipeSecurity::~CurrentUserPipeSecurity() {
  if (descriptor_) LocalFree(descriptor_);
}

}  // namespace cursor_host
