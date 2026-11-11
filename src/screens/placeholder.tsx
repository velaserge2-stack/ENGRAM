import { TAB_INFO, TABS, type TabId } from '../nav';
import { Empty, LargeTitle } from '../ui/kit';

export function Placeholder(props: { tab: TabId }) {
  const t = TABS.find((x) => x.id === props.tab)!;
  return (
    <>
      <LargeTitle title={t.label} />
      <div class="page">
        <Empty icon={<t.icon size={44} aria-hidden="true" />} title={`Llega en la fase ${t.phase}`} action={<a class="btn" href="#/hoy">Ir a Hoy</a>}>
          {TAB_INFO[props.tab] ?? ''}
        </Empty>
      </div>
    </>
  );
}
