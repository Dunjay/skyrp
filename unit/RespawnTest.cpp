#include "TempleRespawn.h"
#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>
#include <string>

PartOne& GetPartOne();
extern espm::Loader l;

TEST_CASE("DeathState packed is correct if actor was killed", "[Respawn]")
{
  PartOne& p = GetPartOne();
  DoConnect(p, 0);
  p.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  p.SetUserActor(0, 0xff000000);
  auto& ac = p.worldState.GetFormAt<MpActor>(0xff000000);

  p.Messages().clear();
  ac.Kill();
  REQUIRE(p.Messages().size() == 1);
  nlohmann::json message = p.Messages()[0].j;
  REQUIRE(message["t"] == MsgType::DeathStateContainer);

  nlohmann::json updateProperyMsg = message["tIsDead"];
  nlohmann::json teleportMsg = message["tTeleport"];
  nlohmann::json changeValuesMsg = message["tChangeValues"];

  REQUIRE(updateProperyMsg["t"] == MsgType::UpdateProperty);
  REQUIRE(updateProperyMsg["propName"] == "isDead");
  REQUIRE(updateProperyMsg["dataDump"] == "true");
  REQUIRE(updateProperyMsg["idx"] == ac.GetIdx());
  REQUIRE(teleportMsg.is_null());
  REQUIRE(changeValuesMsg.is_null());

  REQUIRE(ac.IsDead());
  REQUIRE(ac.GetChangeForm().actorValues.healthPercentage == 0.f);
}

TEST_CASE("DeathState packed is correct if actor is respawning", "[Respawn]")
{
  PartOne& p = GetPartOne();
  DoConnect(p, 0);
  p.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  p.SetUserActor(0, 0xff000000);
  auto& ac = p.worldState.GetFormAt<MpActor>(0xff000000);

  // Fall just outside Whiterun. After bleeding out the player should wake up
  // at the nearest temple, which is the Temple of Kynareth in Whiterun.
  const NiPoint3 deathPos{ 20000.f, 0.f, 0.f };
  ac.SetPos(deathPos);
  ac.SetCellOrWorld(FormDesc::Tamriel());

  const auto& temple = TempleRespawn::GetNearestTemple(deathPos);
  REQUIRE(std::string(temple.name) == "Whiterun");

  ac.Kill();
  p.Messages().clear();
  ac.Respawn();

  // Respawning teleports the player into a temple, which streams in the
  // surrounding cell, so the message count is not fixed. The death-state
  // container is still sent first (before the teleport), and the broadcast
  // "isDead=false" property is found by scanning below.
  REQUIRE(p.Messages().size() >= 2);

  nlohmann::json message = p.Messages()[0].j;
  REQUIRE(message["t"] == MsgType::DeathStateContainer);

  nlohmann::json updateProperyMsg = message["tIsDead"];
  nlohmann::json teleportMsg = message["tTeleport"];
  nlohmann::json changeValuesMsg = message["tChangeValues"];

  REQUIRE(updateProperyMsg["t"] == MsgType::UpdateProperty);
  REQUIRE(updateProperyMsg["propName"] == "isDead");
  REQUIRE(updateProperyMsg["dataDump"] == "false");
  REQUIRE(updateProperyMsg["idx"] == ac.GetIdx());

  REQUIRE(teleportMsg["t"] == MsgType::Teleport);
  REQUIRE(changeValuesMsg["t"] == MsgType::ChangeValues);

  // The player is teleported to the Whiterun temple, not back to where they
  // died.
  REQUIRE(teleportMsg["pos"][0] == temple.destination.pos[0]);
  REQUIRE(teleportMsg["pos"][1] == temple.destination.pos[1]);
  REQUIRE(teleportMsg["pos"][2] == temple.destination.pos[2]);
  REQUIRE(teleportMsg["worldOrCell"] == 0x3c);

  REQUIRE(ac.GetPos() == temple.destination.pos);

  REQUIRE(ac.IsDead() == false);
  REQUIRE(ac.GetChangeForm().actorValues.healthPercentage == 1.f);

  // TODO: should probably not sending to ourselves. see also RespawnEvent.cpp
  // The RespawnEvent broadcasts an "isDead=false" property update; teleport
  // streaming means it is no longer at a fixed index, so scan for it.
  bool foundIsDeadBroadcast = false;
  for (auto& msg : p.Messages()) {
    nlohmann::json j = msg.j; // copy: operator[] auto-inserts null for absentees
    if (j["propName"] == "isDead" && j["dataDump"] == "false" &&
        j["refrId"] == ac.GetFormId()) {
      foundIsDeadBroadcast = true;
      REQUIRE(j["t"] == MsgType::UpdateProperty);
      REQUIRE(j["idx"] == ac.GetIdx());
      REQUIRE(j["baseRecordType"] == nlohmann::json{});
      break;
    }
  }
  REQUIRE(foundIsDeadBroadcast);
}

TEST_CASE("Nearest temple routing covers every hold", "[Respawn]")
{
  using namespace TempleRespawn;

  // Every hold's own anchor resolves to itself: the table has no two anchors
  // that collide.
  for (const auto& temple : GetTemples()) {
    REQUIRE(std::string(GetNearestTemple(temple.anchor).name) == temple.name);
  }

  const NiPoint3 windhelmPos(131512.f, 38458.f, -12522.f);
  const NiPoint3 solitudePos(-58661.f, 110698.f, -7744.f);

  // Temple-less holds route to a neighbouring temple per the design:
  //   Winterhold & Dawnstar -> Windhelm, Morthal -> Solitude.
  REQUIRE(GetNearestTemple(NiPoint3(4000.f, 130000.f, 0.f)).destination.pos ==
          windhelmPos);
  REQUIRE(GetNearestTemple(NiPoint3(130000.f, 123000.f, 0.f)).destination.pos ==
          windhelmPos);
  REQUIRE(GetNearestTemple(NiPoint3(-32000.f, 92000.f, 0.f)).destination.pos ==
          solitudePos);

  // A death out in a temple hold resolves to that hold's own temple.
  REQUIRE(std::string(GetNearestTemple(NiPoint3(20000.f, 0.f, 0.f)).name) ==
          "Whiterun");
  REQUIRE(std::string(
            GetNearestTemple(NiPoint3(170000.f, -90000.f, 0.f)).name) ==
          "Riften");
  REQUIRE(std::string(
            GetNearestTemple(NiPoint3(-170000.f, 4000.f, 0.f)).name) ==
          "Markarth");
}

TEST_CASE("A healed player gets up where they fell, not at a temple",
          "[Respawn]")
{
  PartOne& p = GetPartOne();
  DoConnect(p, 0);
  p.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  p.SetUserActor(0, 0xff000000);
  auto& ac = p.worldState.GetFormAt<MpActor>(0xff000000);

  const NiPoint3 deathPos{ 20000.f, 0.f, 0.f };
  ac.SetPos(deathPos);
  ac.SetCellOrWorld(FormDesc::Tamriel());

  ac.Kill();
  REQUIRE(ac.IsDead());

  // Being healed clears the death state early (shouldTeleport == false). The
  // player stands back up in place and is not whisked off to a temple.
  ac.SetIsDead(false);

  REQUIRE(ac.IsDead() == false);
  REQUIRE(ac.GetPos() == deathPos);
}
