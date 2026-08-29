import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {authFetch} from '@/lib/api';
import type {OperatorAction, PhotoEvidence} from '../api/contracts';
import {uploadOperatorPhoto} from '../forms/photo-form';
import {DefectForm} from '../forms/defect-form';
import {PhotoForm} from '../forms/photo-form';
import {SafetyIncidentForm} from '../forms/safety-incident-form';
import {PersistentSafetyActions} from '../persistent-safety-actions';

vi.mock('@/lib/api', () => ({authFetch: vi.fn()}));

const defectAction: OperatorAction = {
  id: 'report-defect', label: 'Сообщить о дефекте', kind: 'COMMAND', method: 'POST',
  route: '/api/operator/v3/commands/report-defect', expectedVersion: 4,
  offlinePolicy: 'CAPTURE_ONLY', requiresEvidence: ['Фотография'], confirmation: null,
};

const incidentAction: OperatorAction = {
  id: 'report-incident', label: 'Сообщить об опасном событии', kind: 'COMMAND', method: 'POST',
  route: '/api/operator/v3/commands/report-incident', expectedVersion: 4,
  offlinePolicy: 'CAPTURE_ONLY', requiresEvidence: ['Фотография'], confirmation: null,
};

const photo: PhotoEvidence = {mediaId: 'media-1', fileName: 'насос.jpg', contentType: 'image/jpeg', size: 1024};

describe('формы постоянных действий безопасности', () => {
  afterEach(() => {
    vi.mocked(authFetch).mockReset();
    vi.restoreAllMocks();
  });

  it('собирает наблюдаемые признаки дефекта и не предлагает оператору выбирать критичность', () => {
    const onSubmit = vi.fn();
    render(<DefectForm action={defectAction} busy={false} onCancel={vi.fn()} onSubmit={onSubmit} initialEvidence={[photo]} />);

    expect(screen.queryByText(/критичност/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Узел установки'), {target: {value: 'Гидравлический насос'}});
    fireEvent.change(screen.getByLabelText('Что наблюдается'), {target: {value: 'Под насосом появилась жидкость'}});
    fireEvent.click(screen.getByRole('checkbox', {name: 'Утечка'}));
    fireEvent.click(screen.getByRole('button', {name: 'Сохранить дефект'}));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      node: 'Гидравлический насос', description: 'Под насосом появилась жидкость',
      observedSigns: ['LEAK'], safeStopApplied: false, evidenceMediaIds: ['media-1'],
    }));
  });

  it('не позволяет пропустить обязательную фотографию дефекта', () => {
    const onSubmit = vi.fn();
    render(<DefectForm action={defectAction} busy={false} onCancel={vi.fn()} onSubmit={onSubmit} initialEvidence={[]} />);

    fireEvent.change(screen.getByLabelText('Узел установки'), {target: {value: 'Гидравлический насос'}});
    fireEvent.change(screen.getByLabelText('Что наблюдается'), {target: {value: 'Под насосом появилась жидкость'}});
    fireEvent.click(screen.getByRole('checkbox', {name: 'Утечка'}));
    fireEvent.click(screen.getByRole('button', {name: 'Сохранить дефект'}));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Добавьте обязательную фотографию');
    expect(screen.getByLabelText('Фотография доказательства')).toHaveFocus();
  });

  it('показывает инструкцию безопасного поведения до заполнения опасного события', () => {
    render(<SafetyIncidentForm action={incidentAction} busy={false} onCancel={vi.fn()} onSubmit={vi.fn()} initialEvidence={[]} />);

    const instruction = screen.getByRole('alert');
    expect(instruction).toHaveTextContent('Сначала обеспечьте безопасность людей');
    expect(instruction).toHaveTextContent('При угрозе немедленно остановите установку');
    expect(screen.queryByText(/критичност/i)).not.toBeInTheDocument();
  });

  it('отправляет только согласованные наблюдаемые признаки и требует явных ответов о людях и остановке', () => {
    const onSubmit = vi.fn();
    render(<SafetyIncidentForm action={incidentAction} busy={false} onCancel={vi.fn()} onSubmit={onSubmit} initialEvidence={[photo]} />);

    fireEvent.change(screen.getByLabelText('Что произошло'), {target: {value: 'Появился дым из силового отсека'}});
    fireEvent.click(screen.getByRole('checkbox', {name: 'Дым'}));
    fireEvent.click(screen.getByRole('button', {name: 'Сохранить опасное событие'}));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Ответьте, есть ли пострадавшие и применена ли аварийная остановка')).toHaveAttribute('role', 'alert');

    fireEvent.change(screen.getByLabelText('Есть ли пострадавшие'), {target: {value: 'NO'}});
    fireEvent.change(screen.getByLabelText('Применена ли аварийная остановка'), {target: {value: 'YES'}});
    fireEvent.click(screen.getByRole('button', {name: 'Сохранить опасное событие'}));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      category: 'TECHNICAL_HAZARD', observedSigns: ['SMOKE'], injured: false,
      emergencyStopApplied: true, evidenceMediaIds: ['media-1'],
    }));
  });

  it('принимает только изображения и возвращает подтверждённую ссылку вложения', async () => {
    const onChange = vi.fn();
    const upload = vi.fn(async () => photo);
    render(<PhotoForm label="Фотография доказательства" required value={[]} onChange={onChange} upload={upload} />);

    const file = new File(['image'], 'насос.jpg', {type: 'image/jpeg'});
    fireEvent.change(screen.getByLabelText('Фотография доказательства'), {target: {files: [file]}});

    expect(await screen.findByText('Фотография подтверждена')).toBeInTheDocument();
    expect(upload).toHaveBeenCalledWith(file);
    expect(onChange).toHaveBeenCalledWith([photo]);
  });

  it('загружает фотографию, подтверждает её и возвращает идентификатор серверного вложения', async () => {
    vi.mocked(authFetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({mediaId: 'media-1', uploadUrl: 'https://storage.example/upload'}), {status: 200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({id: 'media-1'}), {status: 200}));
    const storageUpload = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, {status: 200}));
    const file = new File(['image'], 'насос.jpg', {type: 'image/jpeg'});

    const result = await uploadOperatorPhoto(file, {entityType: 'equipment_defect', entityId: 'cmd-1'});

    expect(result).toMatchObject({mediaId: 'media-1', fileName: 'насос.jpg', contentType: 'image/jpeg'});
    expect(vi.mocked(authFetch)).toHaveBeenNthCalledWith(1, '/api/media', expect.objectContaining({
      method: 'POST', body: expect.stringContaining('"entityId":"cmd-1"'),
    }));
    expect(storageUpload).toHaveBeenCalledWith('https://storage.example/upload', expect.objectContaining({method: 'PUT'}));
    expect(vi.mocked(authFetch)).toHaveBeenNthCalledWith(2, '/api/media/media-1/confirm', {method: 'POST'});
  });

  it('открывает форму серверной команды вместо немедленной отправки пустого события', () => {
    const onAction = vi.fn();
    render(<PersistentSafetyActions actions={[defectAction, incidentAction, {id: 'add-photo', label: 'Добавить фотографию', kind: 'SCREEN', offlinePolicy: 'CAPTURE_ONLY', requiresEvidence: ['Фотография'], confirmation: null}]} busyActionId={null} onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', {name: 'Сообщить о дефекте'}));

    expect(screen.getByRole('dialog', {name: 'Сообщить о дефекте'})).toBeInTheDocument();
    expect(screen.getByLabelText('Узел установки')).toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('связывает подтверждённую фотографию и команду одним устойчивым идентификатором', async () => {
    vi.mocked(authFetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({mediaId: 'media-2', uploadUrl: 'https://storage.example/upload-2'}), {status: 200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({id: 'media-2'}), {status: 200}));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, {status: 200}));
    const onAction = vi.fn();
    render(<PersistentSafetyActions actions={[defectAction, incidentAction]} busyActionId={null} onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', {name: 'Сообщить о дефекте'}));
    fireEvent.change(screen.getByLabelText('Узел установки'), {target: {value: 'Гидравлический насос'}});
    fireEvent.change(screen.getByLabelText('Что наблюдается'), {target: {value: 'Под насосом появилась жидкость'}});
    fireEvent.click(screen.getByRole('checkbox', {name: 'Утечка'}));
    fireEvent.change(screen.getByLabelText('Фотография доказательства'), {target: {files: [new File(['image'], 'насос.jpg', {type: 'image/jpeg'})]}});
    await screen.findByText('Фотография подтверждена');
    fireEvent.click(screen.getByRole('button', {name: 'Сохранить дефект'}));

    const mediaRequest = JSON.parse(String(vi.mocked(authFetch).mock.calls[0]?.[1]?.body)) as {entityId: string};
    expect(onAction).toHaveBeenCalledWith(defectAction, expect.objectContaining({evidenceMediaIds: ['media-2']}), mediaRequest.entityId);
  });

  it('не закрывает и не очищает форму, если сервер не подтвердил команду', async () => {
    const actionWithoutRequiredPhoto = {...defectAction, requiresEvidence: []};
    const onAction = vi.fn(async () => false);
    render(<PersistentSafetyActions actions={[actionWithoutRequiredPhoto]} busyActionId={null} onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', {name: 'Сообщить о дефекте'}));
    fireEvent.change(screen.getByLabelText('Узел установки'), {target: {value: 'Гидравлический насос'}});
    fireEvent.change(screen.getByLabelText('Что наблюдается'), {target: {value: 'Под насосом появилась жидкость'}});
    fireEvent.click(screen.getByRole('checkbox', {name: 'Утечка'}));
    fireEvent.click(screen.getByRole('button', {name: 'Сохранить дефект'}));

    await waitFor(() => expect(onAction).toHaveBeenCalledOnce());
    expect(screen.getByRole('dialog', {name: 'Сообщить о дефекте'})).toBeInTheDocument();
    expect(screen.getByLabelText('Что наблюдается')).toHaveValue('Под насосом появилась жидкость');
  });
});
