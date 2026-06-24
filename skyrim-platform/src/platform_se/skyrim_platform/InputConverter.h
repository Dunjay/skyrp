#pragma once
#include "IInputConverter.h"

class InputConverter : public IInputConverter
{
public:
  wchar_t VkCodeToChar(uint8_t virtualKeyCode, bool shiftDown,
                       bool capsLockOn) noexcept override;
  void SwitchLayout() noexcept;

private:
  void* keyboardLayout = nullptr;
  std::vector<void*> keyboardLayouts;
  int currentLangId = 0;
};
