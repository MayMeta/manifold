import { JSONContent } from '@tiptap/core'
import { Group } from 'common/group'
import { User } from 'common/user'
import { useEffect, useState } from 'react'
import { groupRoleType } from 'web/components/groups/group-member-modal'
import { db } from 'web/lib/supabase/db'
import {
  getGroup,
  getGroupContractIds,
  getGroupFromSlug,
  getGroupMemberIds,
  getGroupMembers,
  getGroupOfRole,
  getMemberRole,
  getNumGroupMembers,
  MEMBER_LOAD_NUM,
} from 'web/lib/supabase/group'
import { getUser } from 'web/lib/supabase/user'
import { useAdmin } from './use-admin'
import { useIsAuthorized, useUser } from './use-user'
import { Contract } from 'common/contract'
import {
  getMemberGroupIds,
  getMemberGroups,
  listGroupsBySlug,
} from 'web/lib/supabase/groups'
import { uniq } from 'lodash'
import { filterDefined } from 'common/util/array'
import { RealtimeChannel } from '@supabase/realtime-js'
import { usePersistentInMemoryState } from './use-persistent-in-memory-state'
import { getUserIsGroupMember } from 'web/lib/firebase/api'

export function useIsGroupMember(groupSlug: string) {
  const [isMember, setIsMember] = usePersistentInMemoryState<any | undefined>(
    undefined,
    'is-member-' + groupSlug
  )
  const isAuthorized = useIsAuthorized()
  useEffect(() => {
    // if there is no user
    if (isAuthorized === false) {
      setIsMember(false)
    } else if (isAuthorized) {
      getUserIsGroupMember({ groupSlug: groupSlug }).then((result) => {
        setIsMember(result)
      })
    }
  }, [groupSlug, isAuthorized])
  return isMember
}

export function useRealtimeMemberGroups(
  user: User | undefined | null
): Group[] {
  const [groups, setGroups] = useState<Group[]>([])

  const userId = user?.id
  useEffect(() => {
    if (userId) {
      getMemberGroups(user.id, db).then((results) => {
        setGroups(results)
      })
    }
  }, [userId])

  const onInsert = (payload: any) => {
    getGroup(payload.new.group_id).then((newGroup: Group | null) => {
      if (newGroup) {
        setGroups((groups) => {
          return [...groups, newGroup]
        })
      }
    })
  }

  const onDelete = (payload: any) => {
    setGroups((groups) => {
      return groups.filter((group) => group.id !== payload.old.group_id)
    })
  }

  useRealtimeMemberGroupIdsChannel(userId, onInsert, onDelete)

  // ...rest of the code for fetching initial groups
  return groups
}

export function useRealtimeMemberGroupIds(
  user: User | undefined | null
): string[] {
  const [groupIds, setGroupIds] = useState<string[]>([])
  const userId = user?.id

  useEffect(() => {
    if (userId) {
      getMemberGroupIds(user.id, db).then((results) => {
        setGroupIds(results)
      })
    }
  }, [userId])

  const onInsert = (payload: any) => {
    setGroupIds((groupIds) => {
      return [...groupIds, payload.new.group_id]
    })
  }

  const onDelete = (payload: any) => {
    setGroupIds((groupIds) => {
      return groupIds.filter((groupId) => groupId !== payload.old.group_id)
    })
  }

  useRealtimeMemberGroupIdsChannel(userId, onInsert, onDelete)

  // ...rest of the code for fetching initial groupIds
  return groupIds
}

function useRealtimeMemberGroupIdsChannel(
  userId: string | undefined,
  onInsert: (payload: any) => void,
  onDelete: (payload: any) => void
) {
  useEffect(() => {
    let channel: RealtimeChannel | undefined = undefined
    if (userId) {
      channel = db.channel(`group-members-${userId}-group-ids`)
      channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_members',
          filter: `member_id=eq.${userId}`,
        },
        onInsert
      )
      channel.on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'group_members',
          filter: `member_id=eq.${userId}`,
        },
        onDelete
      )
      channel.subscribe(async (status) => {})
    }
    return () => {
      if (channel) {
        db.removeChannel(channel)
      }
    }
  }, [db, userId, onInsert, onDelete])
}

export function useRealtimeGroupContractIds(groupId: string) {
  const [contractIds, setContractIds] = useState<string[]>([])

  useEffect(() => {
    getGroupContractIds(groupId)
      .then((result) => {
        setContractIds(result)
      })
      .catch((e) => console.log(e))
    const channel = db.channel(`group-${groupId}-contract-ids`)
    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'group_contracts',
        filter: `group_id=eq.${groupId}`,
      },
      (payload) => {
        setContractIds((contractIds) => {
          return [...contractIds, payload.new.contract_id]
        })
      }
    )
    channel.on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'group_contracts',
        filter: `group_id=eq.${groupId}`,
      },
      (payload) => {
        setContractIds((contractIds) => {
          return contractIds.filter(
            (contractId) => contractId !== payload.old.contract_id
          )
        })
      }
    )
    channel.subscribe(async (status) => {})
    return () => {
      db.removeChannel(channel)
    }
  }, [db])

  return contractIds
}

export const useGroupsWithContract = (contract: Contract) => {
  const [groups, setGroups] = useState<Group[]>()

  useEffect(() => {
    if (contract.groupSlugs)
      listGroupsBySlug(uniq(contract.groupSlugs)).then((groups) =>
        setGroups(filterDefined(groups))
      )
  }, [contract.groupSlugs])

  return groups
}

export function useRealtimeRole(groupId: string | undefined) {
  const [userRole, setUserRole] = useState<groupRoleType | null | undefined>(
    undefined
  )
  const user = useUser()
  const isManifoldAdmin = useAdmin()
  useEffect(() => {
    if (user && groupId) {
      setTranslatedMemberRole(groupId, isManifoldAdmin, setUserRole, user)
    }
  }, [user, isManifoldAdmin, groupId])
  useEffect(() => {
    const channel = db.channel('user-group-role-realtime')
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'group_members',
        filter: `group_id=eq.${groupId}`,
      },
      (payload) => {
        if ((payload.new as any).member_id === user?.id) {
          setTranslatedMemberRole(groupId, isManifoldAdmin, setUserRole, user)
        }
      }
    )
    channel.subscribe(async (status) => {})
    return () => {
      db.removeChannel(channel)
    }
  }, [db, user])
  return userRole
}

export function useRealtimeGroupMemberIds(groupId: string) {
  const [members, setMembers] = useState<string[]>([])
  useEffect(() => {
    getGroupMemberIds(groupId)
      .then((result) => {
        if (result) {
          setMembers(result)
        }
      })
      .catch((e) => console.log(e))
  }, [])

  useEffect(() => {
    const channel = db.channel('group-members-ids-realtime')
    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'group_members',
        filter: `group_id=eq.${groupId}`,
      },
      (payload) => {
        setMembers((members) => {
          return [...members, payload.new.member_id]
        })
      }
    )
    channel.on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'group_members',
        filter: `group_id=eq.${groupId}`,
      },
      (payload) => {
        setMembers((members) => {
          return members.filter(
            (memberId) => memberId !== payload.old.member_id
          )
        })
      }
    )
    channel.subscribe(async (status) => {})
    return () => {
      db.removeChannel(channel)
    }
  }, [db])
  return members
}

export function useRealtimeGroupMembers(
  groupId: string,
  hitBottom: boolean,
  numMembers: number | undefined
) {
  const [admins, setAdmins] = useState<JSONContent[] | undefined>(undefined)
  const [moderators, setModerators] = useState<JSONContent[] | undefined>(
    undefined
  )
  const [members, setMembers] = useState<JSONContent[] | undefined>(undefined)
  const [loadMore, setLoadMore] = useState<boolean>(false)
  const [offsetPage, setOffsetPage] = useState<number>(0)

  function loadMoreMembers() {
    setLoadMore(true)
    getGroupMembers(groupId, offsetPage + 1)
      .then((result) => {
        if (members) {
          const prevMembers = members
          setMembers([...prevMembers, ...result.data])
        } else {
          setMembers(result.data)
        }
        setOffsetPage((offsetPage) => offsetPage + 1)
      })
      .catch((e) => console.log(e))
      .finally(() => setLoadMore(false))
  }
  function fetchGroupMembers() {
    getGroupOfRole(groupId, 'admin')
      .then((result) => {
        const admins = result.data
        setAdmins(admins)
      })
      .catch((e) => console.log(e))

    getGroupOfRole(groupId, 'moderator')
      .then((result) => {
        const moderators = result.data
        setModerators(moderators)
      })
      .catch((e) => console.log(e))

    getGroupMembers(groupId, offsetPage, 0)
      .then((result) => {
        const members = result.data
        setMembers(members)
      })
      .catch((e) => console.log(e))
  }

  useEffect(() => {
    fetchGroupMembers()
  }, [])

  useEffect(() => {
    if (hitBottom && !loadMore && numMembers && numMembers > MEMBER_LOAD_NUM) {
      loadMoreMembers()
    }
  }, [hitBottom])

  useEffect(() => {
    const channel = db.channel('group-members-realtime')
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'group_members',
        filter: `group_id=eq.${groupId}`,
      },
      (payload) => {
        fetchGroupMembers()
      }
    )
    channel.subscribe(async (status) => {})
    return () => {
      db.removeChannel(channel)
    }
  }, [db])
  return { admins, moderators, members, loadMore }
}

export function useRealtimeNumGroupMembers(groupId: string) {
  const [numMembers, setNumMembers] = useState<number | undefined>(undefined)

  useEffect(() => {
    getNumGroupMembers(groupId)
      .then((result) => setNumMembers(result))
      .catch((e) => console.log(e))
  }, [])

  useEffect(() => {
    const channel = db.channel('group-num-members-realtime')
    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'group_members',
        filter: `group_id=eq.${groupId}`,
      },
      (payload) => {
        getNumGroupMembers(groupId)
          .then((result) => {
            setNumMembers(result)
          })
          .catch((e) => console.log(e))
      }
    )
    channel.on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'group_members',
        filter: `group_id=eq.${groupId}`,
      },
      (_payload) => {
        getNumGroupMembers(groupId)
          .then((result) => setNumMembers(result))
          .catch((e) => console.log(e))
      }
    )
    channel.subscribe(async (status) => {})
    return () => {
      db.removeChannel(channel)
    }
  }, [db])
  return numMembers
}

export async function setTranslatedMemberRole(
  groupId: string | undefined,
  isManifoldAdmin: boolean,
  setRole: (role: groupRoleType | null) => void,
  user?: User | null
) {
  if (isManifoldAdmin) {
    setRole('admin')
  }
  if (user && groupId) {
    getMemberRole(user, groupId)
      .then((result) => {
        if (result.data.length > 0) {
          if (!result.data[0].role) {
            setRole('member')
          } else {
            setRole(result.data[0].role as groupRoleType)
          }
        } else {
          setRole(null)
        }
      })
      .catch((e) => console.log(e))
  } else {
    setRole(null)
  }
}

export function useGroupFromSlug(groupSlug: string) {
  const [group, setGroup] = useState<Group | null>(null)
  useEffect(() => {
    getGroupFromSlug(groupSlug, db)
      .then((result) => {
        setGroup(result)
      })
      .catch((e) => console.log(e))
  }, [groupSlug])

  return group
}

export function useGroupCreator(group?: Group | null) {
  const [creator, setCreator] = useState<User | null>(null)
  useEffect(() => {
    if (group && group.creatorId) {
      getUser(group.creatorId).then((result) => setCreator(result))
    }
  }, [group])
  return creator
}
