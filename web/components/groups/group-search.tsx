import { debounce, isEqual, uniqBy } from 'lodash'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useEvent } from 'web/hooks/use-event'
import { usePersistentInMemoryState } from 'web/hooks/use-persistent-in-memory-state'
import { Group } from 'common/group'
import {
  historyStore,
  inMemoryStore,
  usePersistentState,
} from 'web/hooks/use-persistent-state'
import { Col } from '../layout/col'
import { Input } from '../widgets/input'
import { GroupLine } from './discover-groups'
import { useUser } from 'web/hooks/use-user'
import { searchGroups } from 'web/lib/supabase/groups'

const INITIAL_STATE = {
  groups: undefined,
  fuzzyGroupOffset: 0,
  shouldLoadMore: true,
}

const GROUPS_PER_PAGE = 20

export type groupStateType = {
  groups: Group[] | undefined
  fuzzyGroupOffset: number
  shouldLoadMore: boolean
}

export default function GroupSearch(props: {
  filter?: { yourGroups?: boolean }
  persistPrefix: string
  myGroupIds: string[]
}) {
  const { filter, persistPrefix, myGroupIds } = props
  const user = useUser()
  const performQuery = useEvent(
    async (currentState, freshQuery?: boolean) =>
      (await debouncedQuery(currentState, freshQuery)) ?? false
  )
  const [state, setState] = usePersistentInMemoryState<groupStateType>(
    INITIAL_STATE,
    `${persistPrefix}-supabase-search`
  )

  const searchTerm = useRef<string>('')
  const [inputTerm, setInputTerm] = useState<string>('')
  const searchTermStore = inMemoryStore<string>()

  const requestId = useRef(0)
  const debouncedQuery = useCallback(
    debounce(
      async (currentState, freshQuery?: boolean) =>
        query(currentState, freshQuery),
      200
    ),
    []
  )
  const query = async (currentState: groupStateType, freshQuery?: boolean) => {
    const id = ++requestId.current
    const offset = freshQuery
      ? 0
      : currentState.groups
      ? currentState.groups.length
      : 0
    if (freshQuery || currentState.shouldLoadMore) {
      const results = await searchGroups({
        state: currentState,
        term: searchTerm.current,
        offset: offset,
        limit: GROUPS_PER_PAGE,
        yourGroups: filter?.yourGroups,
      })

      if (id === requestId.current) {
        const newGroups: Group[] = results.data
        const freshGroups = freshQuery
          ? newGroups
          : [...(currentState.groups ? currentState.groups : []), ...newGroups]

        // TODO: When `deleted` is a native supabase column, filter
        // out deleted contracts in backend.

        const newFuzzyGroupOffset =
          results.fuzzyOffset + currentState.fuzzyGroupOffset

        const shouldLoadMore = newGroups.length === GROUPS_PER_PAGE

        setState({
          fuzzyGroupOffset: newFuzzyGroupOffset,
          groups: freshGroups,
          shouldLoadMore,
        })
        if (freshQuery) window.scrollTo(0, 0)

        return shouldLoadMore
      }
    }
    return false
  }

  // Always do first query when loading search page, unless going back in history.
  const [firstQuery, setFirstQuery] = usePersistentState(true, {
    key: `${persistPrefix}-supabase-first-query`,
    store: historyStore(),
  })

  const onSearchTermChanged = useRef(
    debounce((term) => {
      if (!isEqual(searchTerm.current, term) || firstQuery) {
        setFirstQuery(false)
        if (persistPrefix) {
          searchTermStore.set(`${persistPrefix}-params`, term)
        }
        searchTerm.current = term
        setState(INITIAL_STATE)
        performQuery(state, true)
      }
    }, 100)
  ).current

  const groups = state.groups
    ? (uniqBy(state.groups, 'id') as Group[])
    : undefined

  useEffect(() => {
    onSearchTermChanged(inputTerm)
  }, [inputTerm])

  return (
    <Col>
      <Input
        type="text"
        inputMode="search"
        value={inputTerm}
        onChange={(e) => setInputTerm(e.target.value)}
        placeholder="Search groups"
        className="w-full"
      />
      {!groups || groups.length === 0 ? (
        <div>No groups found</div>
      ) : (
        groups.map((group) => (
          <GroupLine
            key={group.id}
            group={group as Group}
            user={user}
            isMember={!!myGroupIds?.includes(group.id)}
          />
        ))
      )}
    </Col>
  )
}
