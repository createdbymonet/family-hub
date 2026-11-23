import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { THEMES, ThemeName } from '../../../../shared/contracts';
import { onFeatureRefresh } from '../../core/feature-refresh';
import { SettingsChanges, SettingsService } from '../../core/settings.service';
import { PageHeaderComponent } from '../../shared/components/page-header.component';

@Component({
  selector: 'app-settings',
  imports: [PageHeaderComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {
  protected readonly preferences = inject(SettingsService);
  protected readonly demo = inject(ActivatedRoute).snapshot.data['demo'] === true;
  protected readonly themes = THEMES;
  protected readonly announcement = signal('');
  protected readonly disabled = computed(
    () =>
      !this.demo &&
      (this.preferences.loading() || this.preferences.saving() || !this.preferences.loaded()),
  );
  protected readonly displayOptions = [
    {
      key: 'showCompletedShoppingItems',
      label: 'Show completed shopping items',
      hint: 'Keep finished errands in view, with the option to undo.',
    },
    {
      key: 'showAchievedWishes',
      label: 'Show achieved wishes',
      hint: 'Look back on the things you have made happen together.',
    },
    {
      key: 'showResolvedNotes',
      label: 'Show resolved notes',
      hint: 'Keep resolved conversations in view, with the option to reopen.',
    },
  ] as const;

  constructor() {
    this.preferences.setDemoMode(this.demo);
    onFeatureRefresh((activity) => {
      if (!this.demo) void this.preferences.load(activity);
    });
  }

  protected chooseTheme(theme: ThemeName): void {
    void this.save({ theme });
  }

  protected toggle(key: keyof Omit<SettingsChanges, 'theme'>, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.checked;
    input.checked = this.preferences.settings()[key];
    void this.save({ [key]: value });
  }

  private async save(changes: SettingsChanges): Promise<void> {
    if (this.disabled()) return;
    this.announcement.set('');
    if (await this.preferences.update(changes, this.demo)) {
      this.announcement.set(
        this.demo
          ? 'Demo preferences updated for this visit.'
          : 'Your preferences have been saved.',
      );
    }
  }
}
