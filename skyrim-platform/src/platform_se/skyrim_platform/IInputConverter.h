#pragma once

class IInputConverter
{
public:
  // Capslock fix
  virtual wchar_t VkCodeToChar(uint8_t virtualKeyCode, bool shiftDown,
                               bool capsLockOn) noexcept = 0;
};
