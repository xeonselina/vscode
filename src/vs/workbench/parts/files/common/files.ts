/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {TPromise} from 'vs/base/common/winjs.base';
import {Event as BaseEvent, PropertyChangeEvent} from 'vs/base/common/events';
import URI from 'vs/base/common/uri';
import Event from 'vs/base/common/event';
import {IEditorOptions, IRawText} from 'vs/editor/common/editorCommon';
import {IDisposable} from 'vs/base/common/lifecycle';
import {IEncodingSupport, EncodingMode, EditorInput, IFileEditorInput, ConfirmResult, IWorkbenchEditorConfiguration, IEditorDescriptor} from 'vs/workbench/common/editor';
import {IFileStat, IFilesConfiguration, IBaseStat, IResolveContentOptions} from 'vs/platform/files/common/files';
import {createDecorator} from 'vs/platform/instantiation/common/instantiation';
import {FileStat} from 'vs/workbench/parts/files/common/explorerViewModel';
import {RawContextKey} from 'vs/platform/contextkey/common/contextkey';
import {ITextEditorModel} from 'vs/platform/editor/common/editor';

/**
 * Explorer viewlet id.
 */
export const VIEWLET_ID = 'workbench.view.explorer';

export const ExplorerViewletVisible = new RawContextKey<boolean>('explorerViewletVisible', true);

/**
 * File editor input id.
 */
export const FILE_EDITOR_INPUT_ID = 'workbench.editors.files.fileEditorInput';

/**
 * Text file editor id.
 */
export const TEXT_FILE_EDITOR_ID = 'workbench.editors.files.textFileEditor';

/**
 * Binary file editor id.
 */
export const BINARY_FILE_EDITOR_ID = 'workbench.editors.files.binaryFileEditor';

/**
 * API class to denote file editor inputs. Internal implementation is provided.
 *
 * Note: This class is not intended to be instantiated.
 */
export abstract class FileEditorInput extends EditorInput implements IFileEditorInput {

	public abstract setResource(resource: URI): void;

	public abstract getResource(): URI;

	public abstract setMime(mime: string): void;

	public abstract getMime(): string;

	public abstract setPreferredEncoding(encoding: string): void;

	public abstract setEncoding(encoding: string, mode: EncodingMode): void;

	public abstract getEncoding(): string;
}

export interface IFilesConfiguration extends IFilesConfiguration, IWorkbenchEditorConfiguration {
	explorer: {
		openEditors: {
			visible: number;
			dynamicHeight: boolean;
		};
		autoReveal: boolean;
		enableDragAndDrop: boolean;
	};
	editor: IEditorOptions;
}

export interface IFileResource {
	resource: URI;
	isDirectory: boolean;
	mimes: string[];
}

/**
 * Helper to get a file resource from an object.
 */
export function asFileResource(obj: any): IFileResource {
	if (obj instanceof FileStat) {
		const stat = <FileStat>obj;

		return {
			resource: stat.resource,
			mimes: stat.mime ? stat.mime.split(', ') : [],
			isDirectory: stat.isDirectory
		};
	}

	return null;
}

/**
 * The save error handler can be installed on the text text file editor model to install code that executes when save errors occur.
 */
export interface ISaveErrorHandler {

	/**
	 * Called whenever a save fails.
	 */
	onSaveError(error: any, model: ITextFileEditorModel): void;
}

export interface ISaveParticipant {

	/**
	 * Participate in a save of a model. Allows to change the model before it is being saved to disk.
	 */
	participate(model: ITextFileEditorModel, env: { reason: SaveReason }): TPromise<any>;
}

/**
 * States the text text file editor model can be in.
 */
export enum ModelState {
	SAVED,
	DIRTY,
	PENDING_SAVE,
	CONFLICT,
	ERROR
}

/**
 * Local file change events are being emitted when a file is added, removed, moved or its contents got updated. These events
 * are being emitted from within the workbench and are not reflecting the truth on the disk file system. For that, please
 * use FileChangesEvent instead.
 */
export class LocalFileChangeEvent extends PropertyChangeEvent {

	constructor(before?: IFileStat, after?: IFileStat, originalEvent?: BaseEvent) {
		super(null, before, after, originalEvent);
	}

	/**
	 * Returns the meta information of the file before the event occurred or null if the file is new.
	 */
	public getBefore(): IFileStat {
		return this.oldValue;
	}

	/**
	 * Returns the meta information of the file after the event occurred or null if the file got deleted.
	 */
	public getAfter(): IFileStat {
		return this.newValue;
	}

	/**
	 * Indicates if the file was added as a new file.
	 */
	public gotAdded(): boolean {
		return !this.oldValue && !!this.newValue;
	}

	/**
	 * Indicates if the file was moved to a different path.
	 */
	public gotMoved(): boolean {
		return !!this.oldValue && !!this.newValue && this.oldValue.resource.toString() !== this.newValue.resource.toString();
	}

	/**
	 * Indicates if the files metadata was updated.
	 */
	public gotUpdated(): boolean {
		return !!this.oldValue && !!this.newValue && !this.gotMoved() && this.oldValue !== this.newValue;
	}

	/**
	 * Indicates if the file was deleted.
	 */
	public gotDeleted(): boolean {
		return !!this.oldValue && !this.newValue;
	}
}

export enum StateChange {
	DIRTY,
	SAVING,
	SAVE_ERROR,
	SAVED,
	REVERTED,
	ENCODING
}

export class TextFileModelChangeEvent {
	private _resource: URI;
	private _kind: StateChange;

	constructor(model: ITextFileEditorModel, kind: StateChange) {
		this._resource = model.getResource();
		this._kind = kind;
	}

	public get resource(): URI {
		return this._resource;
	}

	public get kind(): StateChange {
		return this._kind;
	}
}

export const TEXT_FILE_SERVICE_ID = 'textFileService';

export interface ITextFileOperationResult {
	results: IResult[];
}

export interface IResult {
	source: URI;
	target?: URI;
	success?: boolean;
}

export interface IAutoSaveConfiguration {
	autoSaveDelay: number;
	autoSaveFocusChange: boolean;
	autoSaveApplicationChange: boolean;
}

export enum AutoSaveMode {
	OFF,
	AFTER_SHORT_DELAY,
	AFTER_LONG_DELAY,
	ON_FOCUS_CHANGE,
	ON_WINDOW_CHANGE
}

export enum SaveReason {
	EXPLICIT = 1,
	AUTO = 2,
	FOCUS_CHANGE = 3,
	WINDOW_CHANGE = 4
}

export interface IFileEditorDescriptor extends IEditorDescriptor {
	getMimeTypes(): string[];
}

export const ITextFileService = createDecorator<ITextFileService>(TEXT_FILE_SERVICE_ID);

export interface IRawTextContent extends IBaseStat {

	/**
	 * The line grouped content of a text file.
	 */
	value: IRawText;

	/**
	 * The line grouped logical hash of a text file.
	 */
	valueLogicalHash: string;

	/**
	 * The encoding of the content if known.
	 */
	encoding: string;
}

export interface ITextFileEditorModelManager {

	onModelDirty: Event<TextFileModelChangeEvent>;
	onModelSaveError: Event<TextFileModelChangeEvent>;
	onModelSaved: Event<TextFileModelChangeEvent>;
	onModelReverted: Event<TextFileModelChangeEvent>;
	onModelEncodingChanged: Event<TextFileModelChangeEvent>;

	get(resource: URI): ITextFileEditorModel;

	getAll(resource?: URI): ITextFileEditorModel[];

	loadOrCreate(resource: URI, preferredEncoding: string, refresh?: boolean): TPromise<ITextEditorModel>;
}

export interface IModelSaveOptions {
	reason?: SaveReason;
	overwriteReadonly?: boolean;
	overwriteEncoding?: boolean;
}

export interface ITextFileEditorModel extends ITextEditorModel, IEncodingSupport {

	onDidStateChange: Event<StateChange>;

	getResource(): URI;

	getLastSaveAttemptTime(): number;

	getLastModifiedTime(): number;

	getState(): ModelState;

	updatePreferredEncoding(encoding: string): void;

	save(options?: IModelSaveOptions): TPromise<void>;

	revert(): TPromise<void>;

	setConflictResolutionMode();

	getValue(): string;

	isDirty(): boolean;

	isResolved(): boolean;

	isDisposed(): boolean;
}

export interface ISaveOptions {

	/**
	 * Save the file on disk even if not dirty. If the file is not dirty, it will be touched
	 * so that mtime and atime are updated. This helps to trigger external file watchers.
	 */
	force: boolean;
}

export interface ITextFileService extends IDisposable {
	_serviceBrand: any;
	onAutoSaveConfigurationChange: Event<IAutoSaveConfiguration>;
	onFilesAssociationChange: Event<void>;

	/**
	 * Access to the manager of text file editor models providing further methods to work with them.
	 */
	models: ITextFileEditorModelManager;

	/**
	 * Resolve the contents of a file identified by the resource.
	 */
	resolveTextContent(resource: URI, options?: IResolveContentOptions): TPromise<IRawTextContent>;

	/**
	 * A resource is dirty if it has unsaved changes or is an untitled file not yet saved.
	 *
	 * @param resource the resource to check for being dirty. If it is not specified, will check for
	 * all dirty resources.
	 */
	isDirty(resource?: URI): boolean;

	/**
	 * Returns all resources that are currently dirty matching the provided resources or all dirty resources.
	 *
	 * @param resources the resources to check for being dirty. If it is not specified, will check for
	 * all dirty resources.
	 */
	getDirty(resources?: URI[]): URI[];

	/**
	 * Saves the resource.
	 *
	 * @param resource the resource to save
	 * @return true iff the resource was saved.
	 */
	save(resource: URI, options?: ISaveOptions): TPromise<boolean>;

	/**
	 * Saves the provided resource asking the user for a file name.
	 *
	 * @param resource the resource to save as.
	 * @return true iff the file was saved.
	 */
	saveAs(resource: URI, targetResource?: URI): TPromise<URI>;

	/**
	 * Saves the set of resources and returns a promise with the operation result.
	 *
	 * @param resources can be null to save all.
	 * @param includeUntitled to save all resources and optionally exclude untitled ones.
	 */
	saveAll(includeUntitled?: boolean): TPromise<ITextFileOperationResult>;
	saveAll(resources: URI[]): TPromise<ITextFileOperationResult>;

	/**
	 * Reverts the provided resource.
	 *
	 * @param resource the resource of the file to revert.
	 * @param force to force revert even when the file is not dirty
	 */
	revert(resource: URI, force?: boolean): TPromise<boolean>;

	/**
	 * Reverts all the provided resources and returns a promise with the operation result.
	 *
	 * @param force to force revert even when the file is not dirty
	 */
	revertAll(resources?: URI[], force?: boolean): TPromise<ITextFileOperationResult>;

	/**
	 * Brings up the confirm dialog to either save, don't save or cancel.
	 *
	 * @param resources the resources of the files to ask for confirmation or null if
	 * confirming for all dirty resources.
	 */
	confirmSave(resources?: URI[]): ConfirmResult;

	/**
	 * Convinient fast access to the current auto save mode.
	 */
	getAutoSaveMode(): AutoSaveMode;

	/**
	 * Convinient fast access to the raw configured auto save settings.
	 */
	getAutoSaveConfiguration(): IAutoSaveConfiguration;
}