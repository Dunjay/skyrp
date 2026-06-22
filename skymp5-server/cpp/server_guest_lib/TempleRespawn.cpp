#include "TempleRespawn.h"

#include "FormDesc.h"

#include <limits>
#include <stdexcept>

namespace {

LocationalData MakeTamrielDestination(float x, float y, float z)
{
  // Temples sit in the Tamriel exterior worldspace (0x3c)
  return LocationalData{ NiPoint3(x, y, z), NiPoint3(0.f, 0.f, 0.f),
                         FormDesc::Tamriel() };
}

}

const std::vector<TempleRespawn::Temple>& TempleRespawn::GetTemples()
{
  static const std::vector<Temple> kTemples = [] {
    // Temple destinations
    const LocationalData solitude =
      MakeTamrielDestination(-58661.f, 110698.f, -7744.f);
    const LocationalData markarth =
      MakeTamrielDestination(-176816.f, 4500.f, -1740.f);
    const LocationalData falkreath =
      MakeTamrielDestination(-34593.f, -84340.f, -3447.f);
    const LocationalData whiterun =
      MakeTamrielDestination(24159.f, -3366.f, -2909.f);
    const LocationalData windhelm =
      MakeTamrielDestination(131512.f, 38458.f, -12522.f);
    const LocationalData riften =
      MakeTamrielDestination(176376.f, -97022.f, 11392.f);

    return std::vector<Temple>{
      // Holds that own a temple: the anchor is the temple itself.
      { "Solitude", solitude.pos, solitude },
      { "Markarth", markarth.pos, markarth },
      { "Falkreath", falkreath.pos, falkreath },
      { "Whiterun", whiterun.pos, whiterun },
      { "Windhelm", windhelm.pos, windhelm },
      { "Riften", riften.pos, riften },

      // Temple-less holds
      { "Winterhold", NiPoint3(130000.f, 123000.f, 0.f), windhelm },
      { "Dawnstar", NiPoint3(4000.f, 130000.f, 0.f), windhelm },
      { "Morthal", NiPoint3(-32000.f, 92000.f, 0.f), solitude },
    };
  }();
  return kTemples;
}

const TempleRespawn::Temple& TempleRespawn::GetNearestTemple(
  const NiPoint3& fromPos)
{
  const auto& temples = GetTemples();
  if (temples.empty()) {
    throw std::runtime_error(
      "TempleRespawn::GetNearestTemple - routing table is empty");
  }

  const Temple* nearest = &temples.front();
  float nearestDistanceSq = std::numeric_limits<float>::max();

  for (const auto& temple : temples) {
    // Horizontal (X/Y) distance only. Z varies wildly between temples
    const float dx = temple.anchor[0] - fromPos[0];
    const float dy = temple.anchor[1] - fromPos[1];
    const float distanceSq = dx * dx + dy * dy;
    if (distanceSq < nearestDistanceSq) {
      nearestDistanceSq = distanceSq;
      nearest = &temple;
    }
  }

  return *nearest;
}
