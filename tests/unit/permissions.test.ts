import { describe, expect, it } from "vitest";

import { assignableMembers, canAssignTo, taskPermissions, type PermissionViewer } from "@/lib/permissions";

const members = [
  { id: "me", department_id: "eng" },
  { id: "teammate", department_id: "eng" },
  { id: "other", department_id: "fin" },
  { id: "nodept", department_id: null },
  { id: "gone", department_id: "eng", is_active: false },
];

const employee = (policy: PermissionViewer["assignmentPolicy"]): PermissionViewer => ({
  id: "me",
  role: "employee",
  departmentId: "eng",
  assignmentPolicy: policy,
});

describe("assignment policy (UI mirror)", () => {
  it("anyone: employees can assign any active member", () => {
    expect(assignableMembers(employee("anyone"), members).map((m) => m.id)).toEqual([
      "me",
      "teammate",
      "other",
      "nodept",
    ]);
  });
  it("department: only their department and themselves", () => {
    expect(assignableMembers(employee("department"), members).map((m) => m.id)).toEqual(["me", "teammate"]);
  });
  it("self: only themselves", () => {
    expect(assignableMembers(employee("self"), members).map((m) => m.id)).toEqual(["me"]);
  });
  it("managers and admins ignore the employee policy", () => {
    const manager: PermissionViewer = { ...employee("self"), role: "manager" };
    expect(canAssignTo(manager, members[2])).toBe(true);
  });
  it("leaving a task unassigned is always allowed; inactive members never", () => {
    expect(canAssignTo(employee("self"), null)).toBe(true);
    expect(canAssignTo({ ...employee("anyone"), role: "admin" }, members[4])).toBe(false);
  });
});

describe("taskPermissions (UI mirror)", () => {
  const base = {
    creator_id: "creator",
    assignee_id: "assignee",
    department_id: "eng",
    archived_at: null,
    collaborator_ids: ["collab"],
  };

  it("creator can edit; assignee and collaborators can only work", () => {
    expect(taskPermissions(employee("anyone"), { ...base, creator_id: "me" })).toMatchObject({
      edit: true,
      work: true,
      archive: true,
    });
    expect(taskPermissions(employee("anyone"), { ...base, assignee_id: "me" })).toMatchObject({
      edit: false,
      work: true,
      reassign: true,
    });
    expect(taskPermissions(employee("anyone"), { ...base, collaborator_ids: ["me"] })).toMatchObject({
      edit: false,
      work: true,
      reassign: false,
    });
  });

  it("unrelated employees get read-only access", () => {
    expect(taskPermissions(employee("anyone"), base)).toMatchObject({
      edit: false,
      work: false,
      reassign: false,
      archive: false,
    });
  });

  it("managers edit tasks in their scope only", () => {
    const manager: PermissionViewer = {
      id: "m",
      role: "manager",
      departmentId: null,
      managedDepartmentIds: ["eng"],
      assignmentPolicy: "anyone",
    };
    expect(taskPermissions(manager, base).edit).toBe(true);
    expect(taskPermissions(manager, { ...base, department_id: "fin" }).edit).toBe(false);
  });

  it("archived tasks are locked except for restore", () => {
    const admin: PermissionViewer = { id: "a", role: "admin", departmentId: null, assignmentPolicy: "anyone" };
    expect(taskPermissions(admin, { ...base, archived_at: "2026-10-01T00:00:00Z" })).toMatchObject({
      edit: false,
      work: false,
      archive: false,
      restore: true,
      comment: false,
    });
  });
});
