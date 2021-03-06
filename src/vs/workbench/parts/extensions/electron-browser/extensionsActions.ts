/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/extensionActions';
import { localize } from 'vs/nls';
import { TPromise } from 'vs/base/common/winjs.base';
import { Action } from 'vs/base/common/actions';
import severity from 'vs/base/common/severity';
import paths = require('vs/base/common/paths');
import Event from 'vs/base/common/event';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { ReloadWindowAction } from 'vs/workbench/electron-browser/actions';
import { IExtension, ExtensionState, IExtensionsWorkbenchService, VIEWLET_ID, IExtensionsViewlet, ConfigurationKey, filterOutdatedExtensions } from './extensions';
import { LocalExtensionType } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IMessageService, LaterAction } from 'vs/platform/message/common/message';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ToggleViewletAction } from 'vs/workbench/browser/viewlet';
import { IViewletService } from 'vs/workbench/services/viewlet/common/viewletService';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import { Query } from '../common/extensionQuery';
import { shell, remote } from 'electron';
import { InitialContent } from 'vs/workbench/parts/extensions/electron-browser/extensionsFileTemplate';
import { IFileService } from 'vs/platform/files/common/files';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import URI from 'vs/base/common/uri';

const dialog = remote.dialog;

export class InstallAction extends Action {

	private static InstallLabel = localize('installAction', "Install");
	private static InstallingLabel = localize('installing', "Installing");

	private static Class = 'extension-action install';
	private static InstallingClass = 'extension-action install installing';

	private disposables: IDisposable[] = [];
	private _extension: IExtension;
	get extension(): IExtension { return this._extension; }
	set extension(extension: IExtension) { this._extension = extension; this.update(); }

	constructor(
		@IExtensionsWorkbenchService private extensionsWorkbenchService: IExtensionsWorkbenchService
	) {
		super('extensions.install', InstallAction.InstallLabel, InstallAction.Class, false);

		this.disposables.push(this.extensionsWorkbenchService.onChange(() => this.update()));
		this.update();
	}

	private update(): void {
		if (!this.extension || this.extension.type === LocalExtensionType.System) {
			this.enabled = false;
			this.class = InstallAction.Class;
			this.label = InstallAction.InstallLabel;
			return;
		}

		this.enabled = this.extensionsWorkbenchService.canInstall(this.extension) && this.extension.state === ExtensionState.Uninstalled;

		if (this.extension.state === ExtensionState.Installing) {
			this.label = InstallAction.InstallingLabel;
			this.class = InstallAction.InstallingClass;
		} else {
			this.label = InstallAction.InstallLabel;
			this.class = InstallAction.Class;
		}
	}

	run(): TPromise<any> {
		return this.extensionsWorkbenchService.install(this.extension);
	}

	dispose(): void {
		super.dispose();
		this.disposables = dispose(this.disposables);
	}
}

export class UninstallAction extends Action {

	private disposables: IDisposable[] = [];
	private _extension: IExtension;
	get extension(): IExtension { return this._extension; }
	set extension(extension: IExtension) { this._extension = extension; this.update(); }

	constructor(
		@IExtensionsWorkbenchService private extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IMessageService private messageService: IMessageService,
		@IInstantiationService private instantiationService: IInstantiationService
	) {
		super('extensions.uninstall', localize('uninstall', "Uninstall"), 'extension-action uninstall', false);

		this.disposables.push(this.extensionsWorkbenchService.onChange(() => this.update()));
		this.update();
	}

	private update(): void {
		if (!this.extension) {
			this.enabled = false;
			return;
		}

		if (this.extension.type !== LocalExtensionType.User) {
			this.enabled = false;
			return;
		}

		this.enabled = this.extension.state === ExtensionState.Installed || this.extension.state === ExtensionState.NeedsRestart;
	}

	run(): TPromise<any> {
		if (!window.confirm(localize('deleteSure', "Are you sure you want to uninstall '{0}'?", this.extension.displayName))) {
			return TPromise.as(null);
		}

		return this.extensionsWorkbenchService.uninstall(this.extension).then(() => {
			this.messageService.show(severity.Info, {
				message: localize('postUninstallMessage', "{0} was successfully uninstalled. Restart to deactivate it.", this.extension.displayName),
				actions: [this.instantiationService.createInstance(ReloadWindowAction, ReloadWindowAction.ID, localize('restartNow', "Restart Now")), LaterAction]
			});
		});
	}

	dispose(): void {
		super.dispose();
		this.disposables = dispose(this.disposables);
	}
}

export class CombinedInstallAction extends Action {

	private static NoExtensionClass = 'extension-action install no-extension';
	private installAction: InstallAction;
	private uninstallAction: UninstallAction;
	private disposables: IDisposable[] = [];
	private _extension: IExtension;
	get extension(): IExtension { return this._extension; }
	set extension(extension: IExtension) {
		this._extension = extension;
		this.installAction.extension = extension;
		this.uninstallAction.extension = extension;
	}

	constructor(
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super('extensions.combinedInstall', '', '', false);

		this.installAction = instantiationService.createInstance(InstallAction);
		this.uninstallAction = instantiationService.createInstance(UninstallAction);
		this.disposables.push(this.installAction, this.uninstallAction);

		this.installAction.onDidChange(this.update, this, this.disposables);
		this.uninstallAction.onDidChange(this.update, this, this.disposables);
		this.update();
	}

	private update(): void {
		if (!this.extension || this.extension.type === LocalExtensionType.System) {
			this.enabled = false;
			this.class = CombinedInstallAction.NoExtensionClass;
		} else if (this.installAction.enabled) {
			this.enabled = true;
			this.label = this.installAction.label;
			this.class = this.installAction.class;
		} else if (this.uninstallAction.enabled) {
			this.enabled = true;
			this.label = this.uninstallAction.label;
			this.class = this.uninstallAction.class;
		} else if (this.extension.state === ExtensionState.Installing) {
			this.enabled = false;
			this.label = this.installAction.label;
			this.class = this.installAction.class;
		} else {
			this.enabled = false;
			this.label = this.installAction.label;
			this.class = this.installAction.class;
		}
	}

	run(): TPromise<any> {
		if (this.installAction.enabled) {
			return this.installAction.run();
		} else if (this.uninstallAction.enabled) {
			return this.uninstallAction.run();
		}

		return TPromise.as(null);
	}

	dispose(): void {
		super.dispose();
		this.disposables = dispose(this.disposables);
	}
}

export class UpdateAction extends Action {

	private static EnabledClass = 'extension-action update';
	private static DisabledClass = `${ UpdateAction.EnabledClass } disabled`;

	private disposables: IDisposable[] = [];
	private _extension: IExtension;
	get extension(): IExtension { return this._extension; }
	set extension(extension: IExtension) { this._extension = extension; this.update(); }

	constructor(
		@IExtensionsWorkbenchService private extensionsWorkbenchService: IExtensionsWorkbenchService
	) {
		super('extensions.update', localize('updateAction', "Update"), UpdateAction.DisabledClass, false);

		this.disposables.push(this.extensionsWorkbenchService.onChange(() => this.update()));
		this.update();
	}

	private update(): void {
		if (!this.extension) {
			this.enabled = false;
			this.class = UpdateAction.DisabledClass;
			return;
		}

		if (this.extension.type !== LocalExtensionType.User) {
			this.enabled = false;
			this.class = UpdateAction.DisabledClass;
			return;
		}

		const canInstall = this.extensionsWorkbenchService.canInstall(this.extension);
		const isInstalled = this.extension.state === ExtensionState.Installed
			|| this.extension.state === ExtensionState.NeedsRestart;

		if (canInstall && isInstalled) {
			this.extension.isOutdated().then(outDated => {
				this.enabled = outDated;
				this.updateClass();
			});
		} else {
			this.enabled = false;
			this.updateClass();
		}
	}

	private updateClass(): void {
		this.class = this.enabled ? UpdateAction.EnabledClass : UpdateAction.DisabledClass;
	}

	run(): TPromise<any> {
		return this.extensionsWorkbenchService.install(this.extension);
	}

	dispose(): void {
		super.dispose();
		this.disposables = dispose(this.disposables);
	}
}

export class EnableAction extends Action {

	private static EnabledClass = 'extension-action enable';
	private static DisabledClass = `${ EnableAction.EnabledClass } disabled`;

	private disposables: IDisposable[] = [];
	private _extension: IExtension;
	get extension(): IExtension { return this._extension; }
	set extension(extension: IExtension) { this._extension = extension; this.update(); }

	constructor(
		@IExtensionsWorkbenchService private extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IInstantiationService private instantiationService: IInstantiationService
	) {
		super('extensions.enable', localize('enableAction', "Enable"), EnableAction.DisabledClass, false);

		this.disposables.push(this.extensionsWorkbenchService.onChange(() => this.update()));
		this.update();
	}

	private update(): void {
		if (!this.extension) {
			this.enabled = false;
			this.class = EnableAction.DisabledClass;
			return;
		}

		this.enabled = this.extension.state === ExtensionState.NeedsRestart;
		this.class = this.enabled ? EnableAction.EnabledClass : EnableAction.DisabledClass;
	}

	run(): TPromise<any> {
		if (!window.confirm(localize('restart', "In order to enable this extension, this window of VS Code needs to be restarted.\n\nDo you want to continue?"))) {
			return TPromise.as(null);
		}

		const action = this.instantiationService.createInstance(ReloadWindowAction, ReloadWindowAction.ID, localize('restartNow', "Restart Now"));
		return action.run();
	}

	dispose(): void {
		super.dispose();
		this.disposables = dispose(this.disposables);
	}
}

export class UpdateAllAction extends Action {

	static ID = 'extensions.update-all';
	static LABEL = localize('updateAll', "Update All Extensions");

	private disposables: IDisposable[] = [];

	constructor(
		id = UpdateAllAction.ID,
		label = UpdateAllAction.LABEL,
		@IExtensionsWorkbenchService private extensionsWorkbenchService: IExtensionsWorkbenchService
	) {
		super(id, label, '', false);

		this.disposables.push(this.extensionsWorkbenchService.onChange(() => this.update()));
		this.update();
	}

	private getOutdatedExtensions(): TPromise<IExtension[]> {
		let extensions = this.extensionsWorkbenchService.local.filter(
			e => this.extensionsWorkbenchService.canInstall(e)
			&& e.type === LocalExtensionType.User
			&& (e.state === ExtensionState.Installed || e.state === ExtensionState.NeedsRestart)
		);

		return filterOutdatedExtensions(extensions);
	}

	private update(): void {
		this.getOutdatedExtensions().done(outDated => this.enabled = outDated.length > 0);
	}

	run(): TPromise<any> {
		return this.getOutdatedExtensions().then(outdated => TPromise.join(outdated.map(e => this.extensionsWorkbenchService.install(e))));
	}

	dispose(): void {
		super.dispose();
		this.disposables = dispose(this.disposables);
	}
}

export class OpenExtensionsViewletAction extends ToggleViewletAction {

	static ID = VIEWLET_ID;
	static LABEL = localize('toggleExtensionsViewlet', "Show Extensions");

	constructor(
		id: string,
		label: string,
		@IViewletService viewletService: IViewletService,
		@IWorkbenchEditorService editorService: IWorkbenchEditorService
	) {
		super(id, label, VIEWLET_ID, viewletService, editorService);
	}
}

export class InstallExtensionsAction extends OpenExtensionsViewletAction {
	static ID = 'workbench.extensions.action.installExtensions';
	static LABEL = localize('installExtensions', "Install Extensions");
}

export class ShowInstalledExtensionsAction extends Action {

	static ID = 'workbench.extensions.action.showInstalledExtensions';
	static LABEL = localize('showInstalledExtensions', "Show Installed Extensions");

	constructor(
		id: string,
		label: string,
		@IViewletService private viewletService: IViewletService,
		@IExtensionsWorkbenchService private extensionsWorkbenchService: IExtensionsWorkbenchService
	) {
		super(id, label, 'clear-extensions', true);
	}

	run(): TPromise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('');
				viewlet.focus();
			});
	}
}

export class ClearExtensionsInputAction extends ShowInstalledExtensionsAction {

	static ID = 'workbench.extensions.action.clearExtensionsInput';
	static LABEL = localize('clearExtensionsInput', "Clear Extensions Input");

	private disposables: IDisposable[] = [];

	constructor(
		id: string,
		label: string,
		onSearchChange: Event<string>,
		@IViewletService viewletService: IViewletService,
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService
	) {
		super(id, label, viewletService, extensionsWorkbenchService);
		this.enabled = false;
		onSearchChange(this.onSearchChange, this, this.disposables);
	}

	private onSearchChange(value: string): void {
		this.enabled = !!value;
	}

	dispose(): void {
		this.disposables = dispose(this.disposables);
	}
}

export class ShowOutdatedExtensionsAction extends Action {

	static ID = 'workbench.extensions.action.listOutdatedExtensions';
	static LABEL = localize('showOutdatedExtensions', "Show Outdated Extensions");

	constructor(
		id: string,
		label: string,
		@IViewletService private viewletService: IViewletService
	) {
		super(id, label, null, true);
	}

	run(): TPromise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('@outdated');
				viewlet.focus();
			});
	}

	protected isEnabled(): boolean {
		return true;
	}
}

export class ShowPopularExtensionsAction extends Action {

	static ID = 'workbench.extensions.action.showPopularExtensions';
	static LABEL = localize('showPopularExtensions', "Show Popular Extensions");

	constructor(
		id: string,
		label: string,
		@IViewletService private viewletService: IViewletService
	) {
		super(id, label, null, true);
	}

	run(): TPromise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('@sort:installs');
				viewlet.focus();
			});
	}

	protected isEnabled(): boolean {
		return true;
	}
}

export class ShowRecommendedExtensionsAction extends Action {

	static ID = 'workbench.extensions.action.showRecommendedExtensions';
	static LABEL = localize('showRecommendedExtensions', "Show Recommended Extensions");

	constructor(
		id: string,
		label: string,
		@IViewletService private viewletService: IViewletService
	) {
		super(id, label, null, true);
	}

	run(): TPromise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('@recommended');
				viewlet.focus();
			});
	}

	protected isEnabled(): boolean {
		return true;
	}
}

export class ShowWorkspaceRecommendedExtensionsAction extends Action {

	static ID = 'workbench.extensions.action.showWorkspaceRecommendedExtensions';
	static LABEL = localize('showWorkspaceRecommendedExtensions', "Show Workspace Recommended Extensions");

	constructor(
		id: string,
		label: string,
		@IViewletService private viewletService: IViewletService
	) {
		super(id, label, null, true);
	}

	run(): TPromise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('@recommended:workspace');
				viewlet.focus();
			});
	}

	protected isEnabled(): boolean {
		return true;
	}
}

export class ChangeSortAction extends Action {

	private query: Query;
	private disposables: IDisposable[] = [];

	constructor(
		id: string,
		label: string,
		onSearchChange: Event<string>,
		private sortBy: string,
		private sortOrder: string,
		@IViewletService private viewletService: IViewletService
	) {
		super(id, label, null, true);

		if (sortBy === undefined && sortOrder === undefined) {
			throw new Error('bad arguments');
		}

		this.query = Query.parse('');
		this.enabled = false;
		onSearchChange(this.onSearchChange, this, this.disposables);
	}

	private onSearchChange(value: string): void {
		const query = Query.parse(value);
		this.query = new Query(query.value, this.sortBy || query.sortBy, this.sortOrder || query.sortOrder);
		this.enabled = value && this.query.isValid() && !this.query.equals(query);
	}

	run(): TPromise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search(this.query.toString());
				viewlet.focus();
			});
	}

	protected isEnabled(): boolean {
		return true;
	}
}

export class OpenExtensionsFolderAction extends Action {

	static ID = 'workbench.extensions.action.openExtensionsFolder';
	static LABEL = localize('openExtensionsFolder', "Open Extensions Folder");

	constructor(
		id: string,
		label: string,
		@IEnvironmentService private environmentService: IEnvironmentService
	) {
		super(id, label, null, true);
	}

	run(): TPromise<any> {
		const extensionsHome = this.environmentService.extensionsPath;
		shell.showItemInFolder(paths.normalize(extensionsHome, true));

		return TPromise.as(true);
	}

	protected isEnabled(): boolean {
		return true;
	}
}

export class ConfigureWorkspaceRecommendedExtensionsAction extends Action {

	static ID = 'workbench.extensions.action.configureWorkspaceRecommendedExtensions';
	static LABEL = localize('configureWorkspaceRecommendedExtensions', "Configure Workspace Recommended Extensions");

	constructor(
		id: string,
		label: string,
		@IFileService private fileService: IFileService,
		@IWorkspaceContextService private contextService: IWorkspaceContextService,
		@IExtensionsWorkbenchService private extensionsService: IExtensionsWorkbenchService,
		@IWorkbenchEditorService private editorService: IWorkbenchEditorService,
		@IMessageService private messageService: IMessageService
	) {
		super(id, label, null, true);
	}

	public run(event: any): TPromise<any> {
		return this.openExtensionsFile();
	}

	private openExtensionsFile(): TPromise<any> {
		if (!this.contextService.getWorkspace()) {
			this.messageService.show(severity.Info, localize('ConfigureWorkspaceRecommendations.noWorkspace', 'Recommendations are only available on a workspace folder.'));
			return TPromise.as(undefined);
		}

		return this.getOrCreateExtensionsFile().then(value => {
			return this.editorService.openEditor({
				resource: value.extensionsFileResource,
				options: {
					forceOpen: true,
					pinned: value.created
				},
			});
		}, (error) => TPromise.wrapError(new Error(localize('OpenExtensionsFile.failed', "Unable to create 'extensions.json' file inside the '.vscode' folder ({0}).", error))));
	}

	private getOrCreateExtensionsFile(): TPromise<{ created: boolean, extensionsFileResource: URI }> {
		const extensionsFileResource = URI.file(paths.join(this.contextService.getWorkspace().resource.fsPath, '.vscode', `${ ConfigurationKey }.json`));

		return this.fileService.resolveContent(extensionsFileResource).then(content => {
			return { created: false, extensionsFileResource };
		}, err => {
			return this.fileService.updateContent(extensionsFileResource, InitialContent).then(() => {
				return { created: true, extensionsFileResource };
			});
		});
	}
}

export class InstallVSIXAction extends Action {

	static ID = 'workbench.extensions.action.installVSIX';
	static LABEL = localize('installVSIX', "Install from VSIX...");

	constructor(
		id = InstallVSIXAction.ID,
		label = InstallVSIXAction.LABEL,
		@IExtensionsWorkbenchService private extensionsWorkbenchService: IExtensionsWorkbenchService
	) {
		super(id, label, 'extension-action install-vsix', true);
	}

	run(): TPromise<any> {
		const result = dialog.showOpenDialog(remote.getCurrentWindow(), {
			filters: [{ name: 'VSIX Extensions', extensions: ['vsix'] }],
			properties: ['openFile']
		});

		if (!result) {
			return TPromise.as(null);
		}

		return TPromise.join(result.map(vsix => this.extensionsWorkbenchService.install(vsix)));
	}
}

export class BuiltinStatusLabelAction extends Action {

	private static Class = 'extension-action built-in-status';

	private _extension: IExtension;
	get extension(): IExtension { return this._extension; }
	set extension(extension: IExtension) { this._extension = extension; this.update(); }

	constructor() {
		super('extensions.install', localize('builtin', "Built-in"), '', false);
	}

	private update(): void {
		if (this.extension && this.extension.type === LocalExtensionType.System) {
			this.class = `${ BuiltinStatusLabelAction.Class } system`;
		} else {
			this.class = `${ BuiltinStatusLabelAction.Class } user`;
		}
	}

	run(): TPromise<any> {
		return TPromise.as(null);
	}
}
